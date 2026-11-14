"""A group with more WDQS candidates than the limit keeps the run going."""

import io
import json
import os
import random
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

from kpop_scraping.cli import main
from kpop_scraping.exit_codes import EXIT_DETERMINISTIC, EXIT_OK
from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.release_discovery import (
    MAX_CANDIDATES_PER_GROUP,
    MAX_RESPONSE_BYTES,
    DiscoveredRelease,
    TruncatedGroup,
    WikidataQueryClient,
    _parse_results,
    _qid_order,
    build_query,
    discover_releases,
)
from kpop_scraping.release_pipeline import _mark_stale_releases
from kpop_scraping.storage import MIGRATIONS, Repository, apply_migrations


ENTITY = "http://www.wikidata.org/entity/"


def wdqs_body(candidates):
    """Serialize (group QID, release QID) pairs as a WDQS JSON response."""
    bindings = [
        {"performer": {"value": ENTITY + group}, "release": {"value": ENTITY + release}}
        for group, release in candidates
    ]
    return json.dumps({"results": {"bindings": bindings}}).encode()


class FakeQueryClient:
    endpoint = "https://query.example/sparql"

    def __init__(self, body):
        self.body = body

    def query(self, _sparql):
        return type("Result", (), {"body": self.body, "http_status": 200})()


class _Response(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def seed_accepted_groups(database, qids):
    """Store accepted catalog groups, the only input of release discovery."""
    with Repository(database, raw_dir=database.parent / "raw") as repository:
        connection = repository.connection
        connection.execute(
            "INSERT INTO collection_runs(id,category,started_at,status) VALUES (1,'x','t','completed')"
        )
        connection.execute(
            """INSERT INTO wikidata_entity_snapshots(
                id,wikidata_id,external_revision_id,request_profile,snapshot_path,content_sha256,fetched_at
            ) VALUES (1,'Q0',1,'subject-v1','fixture',?,'t')""",
            ("0" * 64,),
        )
        connection.execute(
            "INSERT INTO catalog_runs(id,classifier_version,started_at,status) VALUES (1,'v','t','completed')"
        )
        for qid in qids:
            entity_id = connection.execute(
                """INSERT INTO entities(entity_type,wikidata_id,canonical_name,snapshot_id,created_at,updated_at)
                VALUES ('group',?,?,1,'t','t')""",
                (qid, qid),
            ).lastrowid
            page_id = connection.execute(
                """INSERT INTO source_pages(
                    provider,language,external_page_id,title,canonical_url,extract,fetched_at,last_run_id
                ) VALUES ('wikipedia','en',?,?,?,'','t',1)""",
                (int(qid[1:]), qid, f"https://example.test/{qid}"),
            ).lastrowid
            revision_id = connection.execute(
                """INSERT INTO source_revisions(
                    source_page_id,external_revision_id,snapshot_path,content_sha256,fetched_at
                ) VALUES (?,?,?,?,'t')""",
                (page_id, int(qid[1:]), f"{qid}.json.gz", "1" * 64),
            ).lastrowid
            connection.execute(
                """INSERT INTO catalog_entries(
                    source_page_id,source_revision_id,analyzed_wikidata_id,state,classifier_version,classified_at
                ) VALUES (?,?,?,'accepted','v','t')""",
                (page_id, revision_id, qid),
            )
            connection.execute(
                """INSERT INTO catalog_entity_links(
                    source_page_id,entity_id,requested_wikidata_id,resolved_wikidata_id,linked_at
                ) VALUES (?,?,?,?,'t')""",
                (page_id, entity_id, qid, qid),
            )
        connection.commit()


ROOT = Path(__file__).resolve().parent.parent


class CandidateTruncationTest(unittest.TestCase):
    def test_group_keeps_the_lowest_qids_by_number(self):
        # By text, Q10, Q100 and Q1000 would be the three lowest.
        body = wdqs_body([("Q1", qid) for qid in ("Q1000", "Q123", "Q10", "Q9", "Q100")])

        releases, truncated = _parse_results(body, {"Q1"}, 3)

        self.assertEqual([item.release_id for item in releases], ["Q9", "Q10", "Q100"])
        self.assertEqual(truncated, (TruncatedGroup("Q1", 5, 3, "Q100"),))
        self.assertEqual(truncated[0].discarded, 2)

    def test_only_the_group_above_the_limit_is_cut(self):
        body = wdqs_body([
            ("Q2", "Q30"), ("Q1", "Q12"), ("Q2", "Q20"), ("Q1", "Q11"),
            ("Q1", "Q13"), ("Q3", "Q40"),
        ])

        releases, truncated = _parse_results(body, {"Q1", "Q2", "Q3"}, 2)

        self.assertEqual(
            releases,
            (
                DiscoveredRelease("Q1", "Q11"), DiscoveredRelease("Q1", "Q12"),
                DiscoveredRelease("Q2", "Q20"), DiscoveredRelease("Q2", "Q30"),
                DiscoveredRelease("Q3", "Q40"),
            ),
        )
        self.assertEqual(truncated, (TruncatedGroup("Q1", 3, 2, "Q12"),))

    def test_repeated_bindings_count_once(self):
        body = wdqs_body([("Q1", "Q5"), ("Q1", "Q5"), ("Q1", "Q6"), ("Q1", "Q6")])
        releases, truncated = _parse_results(body, {"Q1"}, 2)
        self.assertEqual(len(releases), 2)
        self.assertEqual(truncated, ())

    def test_cut_does_not_depend_on_the_hash_seed(self):
        candidates = [(group, f"Q{number}") for group in ("Q1", "Q2") for number in range(500, 0, -3)]
        random.Random(7).shuffle(candidates)
        script = (
            "import sys\n"
            "from kpop_scraping.release_discovery import _parse_results\n"
            "releases, truncated = _parse_results(sys.stdin.buffer.read(), {'Q1', 'Q2'}, 100)\n"
            "print([(r.group_id, r.release_id) for r in releases], truncated)\n"
        )
        outputs = set()
        for seed in ("0", "1", "4242"):
            result = subprocess.run(
                [sys.executable, "-c", script],
                input=wdqs_body(candidates),
                capture_output=True,
                cwd=ROOT,
                env={**os.environ, "PYTHONHASHSEED": seed},
                check=True,
                timeout=60,
            )
            outputs.add(result.stdout)
        self.assertEqual(len(outputs), 1)

    def test_order_is_numeric_for_long_qids(self):
        # 5000 digits: int() refuses strings above 4300 digits.
        huge = "Q" + "9" * 5000
        body = wdqs_body([("Q1", qid) for qid in (huge, "Q7", "Q70", "Q8", "Q10", "Q9")])

        releases, truncated = _parse_results(body, {"Q1"}, 5)

        self.assertEqual([item.release_id for item in releases], ["Q7", "Q8", "Q9", "Q10", "Q70"])
        self.assertEqual(truncated, (TruncatedGroup("Q1", 6, 5, "Q70"),))

    def test_qid_order_matches_int_order(self):
        rng = random.Random(1)
        qids = [
            "Q" + str(rng.randint(1, 9)) + "".join(rng.choice("0123456789") for _ in range(rng.randint(0, 29)))
            for _ in range(2000)
        ]
        self.assertEqual(sorted(qids, key=_qid_order), sorted(qids, key=lambda qid: int(qid[1:])))

    def test_release_qid_must_be_canonical(self):
        # str.isdigit() accepts "²" and "١", and Q7, Q07 and Q007 would take
        # three slots for one item.
        for release in ("Q²", "Q١٢", "Q", "P5", "Q5x", "Q0", "Q07", "Q007"):
            with self.subTest(release), self.assertRaisesRegex(MediaWikiError, "unexpected entity"):
                _parse_results(wdqs_body([("Q1", release)]), {"Q1"}, 100)

    def test_query_accepts_only_canonical_group_qids(self):
        self.assertIn("wd:Q20 wd:Q7", build_query(["Q20", "Q7"]))
        for group in ("Q²", "Q١", "Q0", "Q07", "q7"):
            with self.subTest(group), self.assertRaisesRegex(ValueError, "unique Wikidata QIDs"):
                build_query([group])

    def test_migration_records_no_discarded_candidate_for_earlier_runs(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        apply_migrations(connection, MIGRATIONS[:11])
        connection.execute(
            "INSERT INTO wikidata_entity_snapshots(id,wikidata_id,external_revision_id,request_profile,snapshot_path,content_sha256,fetched_at) VALUES (1,'Q0',1,'subject-v1','f',?,'t')",
            ("0" * 64,),
        )
        connection.execute(
            "INSERT INTO entities(id,entity_type,wikidata_id,canonical_name,snapshot_id,created_at,updated_at) VALUES (1,'group','Q1','G',1,'t','t')"
        )
        connection.execute(
            "INSERT INTO release_discovery_runs(id,discoverer_version,query,query_sha256,endpoint,started_at,status) VALUES (1,'v','q',?,'e','t','completed')",
            ("0" * 64,),
        )
        connection.execute("INSERT INTO release_discovery_groups(run_id,group_entity_id) VALUES (1,1)")
        connection.commit()

        apply_migrations(connection, MIGRATIONS)

        self.assertEqual(
            connection.execute("SELECT candidates_discarded FROM release_discovery_groups").fetchone()[0], 0
        )
        self.assertIsNone(
            connection.execute("SELECT last_kept_wikidata_id FROM release_discovery_groups").fetchone()[0]
        )
        for discarded, last_kept in ((-1, None), (3, None), (0, "Q5"), (3, "Q05"), (3, "Q5x"), (3, "Q²")):
            with self.subTest(discarded=discarded, last_kept=last_kept), self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "UPDATE release_discovery_groups SET candidates_discarded=?,last_kept_wikidata_id=?",
                    (discarded, last_kept),
                )
        connection.execute("UPDATE release_discovery_groups SET candidates_discarded=3,last_kept_wikidata_id='Q50'")
        connection.close()


class ReleaseCandidateLimitRunTest(unittest.TestCase):
    """``python main.py --releases`` with the WDQS answer replaced."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Path(directory.name) / "kpop.db"
        seed_accepted_groups(self.database, ("Q20", "Q7"))

    def run_releases(self, client, environment=None):
        """Run the CLI with every stage but release discovery replaced."""
        stdout, stderr = io.StringIO(), io.StringIO()
        with ExitStack() as stack:
            for target, value in (
                ("collect_category", 0),
                ("export_fact_coverage_csv", 0),
                ("export_release_coverage_csv", 0),
            ):
                stack.enter_context(patch(f"kpop_scraping.cli.{target}", return_value=value))
            stack.enter_context(patch("kpop_scraping.cli.classify_catalog"))
            stack.enter_context(
                patch("kpop_scraping.cli.extract_facts", return_value=MagicMock(birth_before=(), birth_after=()))
            )
            for client_class in ("MediaWikiClient", "WikidataEntityClient", "WikidataTypeClient"):
                stack.enter_context(patch(f"kpop_scraping.cli.{client_class}"))
            stack.enter_context(patch("kpop_scraping.cli.WikidataQueryClient", return_value=client))
            collect = stack.enter_context(patch("kpop_scraping.cli.collect_release_facts"))
            stack.enter_context(patch.dict(os.environ, environment or {}))
            stack.enter_context(redirect_stdout(stdout))
            stack.enter_context(redirect_stderr(stderr))
            code = main(["--database", str(self.database), "--releases"])
        return code, stdout.getvalue(), stderr.getvalue(), collect

    def stored(self, sql, *params):
        with Repository(self.database, raw_dir=self.database.parent / "raw") as repository:
            return [tuple(row) for row in repository.connection.execute(sql, params)]

    def test_group_above_the_candidate_limit_is_truncated_and_the_run_completes(self):
        # Q20 gets 103 candidates; Q7 stays under the limit.
        over = [("Q20", f"Q{number}") for number in range(1000, 1103)]
        under = [("Q7", "Q5"), ("Q7", "Q50")]
        code, stdout, stderr, collect = self.run_releases(
            FakeQueryClient(wdqs_body(over + under)), {"GITHUB_ACTIONS": "true"}
        )

        self.assertEqual(code, EXIT_OK, stdout)
        self.assertNotIn("Pipeline failed", stdout)
        run_id = self.stored("SELECT id FROM release_discovery_runs")[0][0]
        self.assertEqual(collect.call_args.args[2], run_id)
        self.assertEqual(
            self.stored("SELECT status,candidates_found FROM release_discovery_runs"),
            [("completed", MAX_CANDIDATES_PER_GROUP + 2)],
        )
        self.assertEqual(
            self.stored(
                """SELECT e.wikidata_id,rdg.candidates_discarded,rdg.last_kept_wikidata_id
                FROM release_discovery_groups rdg
                JOIN entities e ON e.id=rdg.group_entity_id ORDER BY e.wikidata_id"""
            ),
            [("Q20", 3, "Q1099"), ("Q7", 0, None)],
        )
        kept = self.stored(
            """SELECT rc.requested_wikidata_id FROM release_candidates rc
            JOIN entities e ON e.id=rc.group_entity_id WHERE e.wikidata_id='Q20'"""
        )
        self.assertEqual(
            sorted(int(qid[1:]) for (qid,) in kept), list(range(1000, 1000 + MAX_CANDIDATES_PER_GROUP))
        )
        message = (
            "WDQS returned 103 release candidates for group Q20; "
            "kept the 100 with the lowest QIDs and discarded 3"
        )
        self.assertIn(f"WARNING: {message}\n", stderr)
        self.assertIn(f"::warning title=Release candidates truncated::{message}\n", stdout)
        self.assertIn("1 group truncated at 100 candidates", stdout)

    def test_truncation_outside_actions_has_no_annotation(self):
        over = [("Q20", f"Q{number}") for number in range(1, 102)]
        code, stdout, stderr, _collect = self.run_releases(
            FakeQueryClient(wdqs_body(over)), {"GITHUB_ACTIONS": ""}
        )
        self.assertEqual(code, EXIT_OK)
        self.assertIn("WARNING: WDQS returned 101 release candidates for group Q20", stderr)
        self.assertNotIn("::warning", stdout)

    def test_truncated_set_does_not_depend_on_the_answer_order(self):
        # 150 candidates whose decimal strings sort differently from their
        # numbers: by text, Q1000 to Q1049 would come before Q101.
        numbers = [*range(1, 101), *range(1000, 1050)]
        kept_sets = []
        for seed in (1, 2):
            candidates = [("Q20", f"Q{number}") for number in numbers]
            random.Random(seed).shuffle(candidates)
            directory = tempfile.TemporaryDirectory()
            self.addCleanup(directory.cleanup)
            self.database = Path(directory.name) / "kpop.db"
            seed_accepted_groups(self.database, ("Q20",))
            code, *_ = self.run_releases(FakeQueryClient(wdqs_body(candidates)))
            self.assertEqual(code, EXIT_OK)
            kept_sets.append(
                sorted(qid for (qid,) in self.stored("SELECT requested_wikidata_id FROM release_candidates"))
            )
        self.assertEqual(kept_sets[0], kept_sets[1])
        self.assertEqual(sorted(kept_sets[0]), sorted(f"Q{number}" for number in range(1, 101)))

    def test_response_above_five_megabytes_still_aborts_the_run(self):
        self.assertEqual(MAX_RESPONSE_BYTES, 5_000_000)
        self.assertEqual(WikidataQueryClient().max_response_bytes, MAX_RESPONSE_BYTES)
        body = wdqs_body([("Q20", "Q1")])
        oversize = body + b" " * (MAX_RESPONSE_BYTES + 1 - len(body))
        client = WikidataQueryClient(opener=lambda *_args, **_kwargs: _Response(oversize))

        code, stdout, _stderr, collect = self.run_releases(client)

        self.assertEqual(code, EXIT_DETERMINISTIC)
        self.assertIn(
            "Pipeline failed: MediaWikiError: WDQS response exceeds the configured size limit", stdout
        )
        collect.assert_not_called()
        self.assertEqual(self.stored("SELECT status FROM release_discovery_runs"), [("failed",)])
        self.assertEqual(self.stored("SELECT COUNT(*) FROM release_candidates"), [(0,)])


class StaleReleasesAfterCutTest(unittest.TestCase):
    """``_mark_stale_releases`` after discoveries that keep three candidates per group.

    Q20 and Q7 are the catalog groups. Each discovery settles its kept
    candidates the way ``collect_release_facts`` does, and every accepted
    release has one accepted fact and one accepted Wikipedia page.
    """

    LIMIT = 3

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        database = Path(directory.name) / "kpop.db"
        seed_accepted_groups(database, ("Q20", "Q7"))
        self.repository = Repository(database, raw_dir=database.parent / "raw")
        self.addCleanup(self.repository.connection.close)
        self.connection = self.repository.connection
        self.fact_run = self._fact_run("completed")
        self.entities = {}

    def _fact_run(self, status):
        return self.connection.execute(
            "INSERT INTO fact_runs(extractor_version,source_policy_version,started_at,status) VALUES ('v','v','t',?)",
            (status,),
        ).lastrowid

    def _release(self, qid):
        """Return the entity of a release, created with an accepted fact and page."""
        if qid not in self.entities:
            entity_id = self.connection.execute(
                """INSERT INTO entities(entity_type,wikidata_id,canonical_name,snapshot_id,created_at,updated_at)
                VALUES ('album',?,?,1,'t','t')""",
                (qid, qid),
            ).lastrowid
            self.connection.execute(
                """INSERT INTO facts(
                    subject_entity_id,predicate,property_id,statement_id,rank,
                    value_time,value_precision,value_calendar,value_raw_json,
                    qualifiers_json,references_json,status,quality_flags_json,
                    snapshot_id,fact_run_id,extractor_version,extracted_at
                ) VALUES (?,'released_on','P577',?,'normal','+2020-01-02T00:00:00Z',11,
                    'http://www.wikidata.org/entity/Q1985727','{}','{}','[]','accepted','[]',1,?,'v','t')""",
                (entity_id, f"{qid}$date", self.fact_run),
            )
            self.connection.execute(
                """INSERT INTO release_source_pages(
                    release_entity_id,language,source_page_id,source_revision_id,
                    wikidata_snapshot_id,state,checked_at
                ) VALUES (?,'en',1,1,1,'accepted','t')""",
                (entity_id,),
            )
            self.entities[qid] = entity_id
        return self.entities[qid]

    def discover(self, answer, rejected=()):
        """Store one discovery of ``answer`` and settle the kept candidates."""
        run_id = discover_releases(
            self.repository, FakeQueryClient(wdqs_body(answer)), max_per_group=self.LIMIT
        ).run_id
        rows = self.connection.execute(
            "SELECT id,requested_wikidata_id FROM release_candidates WHERE run_id=?", (run_id,)
        ).fetchall()
        for row_id, qid in rows:
            state, reason = ("rejected", "test") if qid in rejected else ("accepted", None)
            self.connection.execute(
                "UPDATE release_candidates SET resolved_wikidata_id=?,entity_id=?,state=?,reason=? WHERE id=?",
                (qid, self._release(qid), state, reason, row_id),
            )
        return run_id

    def retire(self, run_id):
        _mark_stale_releases(self.connection, run_id, self._fact_run("running"))

    def candidates(self, run_id):
        return [
            tuple(row)
            for row in self.connection.execute(
                """SELECT g.wikidata_id,rc.requested_wikidata_id,rc.state FROM release_candidates rc
                JOIN entities g ON g.id=rc.group_entity_id WHERE rc.run_id=?
                ORDER BY g.wikidata_id,length(rc.requested_wikidata_id),rc.requested_wikidata_id""",
                (run_id,),
            )
        ]

    def assert_release(self, qid, state):
        """The fact and the Wikipedia page of the release are in ``state``."""
        entity_id = self.entities[qid]
        fact = self.connection.execute(
            "SELECT status FROM facts WHERE subject_entity_id=?", (entity_id,)
        ).fetchone()[0]
        page = self.connection.execute(
            "SELECT state FROM release_source_pages WHERE release_entity_id=?", (entity_id,)
        ).fetchone()[0]
        self.assertEqual((qid, fact, page), (qid, state, state))

    def test_missing_release_below_the_last_kept_candidate_is_retired(self):
        # Q100 left the answer, and its QID comes before the last kept one
        # (Q400): it was not discarded, so the cut cannot explain its absence.
        previous = self.discover([("Q20", "Q100"), ("Q20", "Q200")])
        for _run in range(3):
            current = self.discover([("Q20", qid) for qid in ("Q200", "Q300", "Q400", "Q500")])
            self.retire(current)

        self.assertEqual(self.candidates(previous), [("Q20", "Q100", "stale"), ("Q20", "Q200", "accepted")])
        self.assert_release("Q100", "stale")
        self.assert_release("Q200", "accepted")

    def test_kept_candidate_rejected_now_retires_its_accepted_row(self):
        # Q100 is the last kept candidate, so this run checked it again.
        previous = self.discover([("Q20", "Q100")])
        current = self.discover([("Q20", qid) for qid in ("Q50", "Q60", "Q100", "Q500")], rejected={"Q100"})
        self.retire(current)

        self.assertEqual(self.candidates(previous), [("Q20", "Q100", "stale")])
        self.assertEqual(
            self.candidates(current),
            [("Q20", "Q50", "accepted"), ("Q20", "Q60", "accepted"), ("Q20", "Q100", "rejected")],
        )
        self.assert_release("Q100", "stale")

    def test_the_cut_hides_only_qids_after_the_last_kept_one_by_number(self):
        # By text, Q9 comes after Q99 and Q1000 before it.
        previous = self.discover([("Q20", "Q9"), ("Q20", "Q1000")])
        current = self.discover([("Q20", qid) for qid in ("Q8", "Q10", "Q99", "Q1000")])
        self.retire(current)

        self.assertEqual(self.candidates(previous), [("Q20", "Q9", "stale"), ("Q20", "Q1000", "accepted")])
        self.assert_release("Q9", "stale")
        self.assert_release("Q1000", "accepted")

    def test_qids_beyond_64_bits_compare_as_numbers(self):
        # CAST(... AS INTEGER) saturates at 2**63 - 1 and would tie all of them.
        prefix = "Q" + "9" * 25
        previous = self.discover([("Q20", prefix + "4"), ("Q20", prefix + "7")])
        current = self.discover([("Q20", prefix + digit) for digit in "1357"])
        self.retire(current)

        self.assertEqual(
            self.candidates(previous), [("Q20", prefix + "4", "stale"), ("Q20", prefix + "7", "accepted")]
        )

    def test_shared_release_stays_accepted_while_the_cut_may_hide_it(self):
        # Q900 comes after the last kept candidate of Q20 (Q300), and Q7 no
        # longer has it: the row of Q7 is retired, the facts stay.
        previous = self.discover([("Q20", "Q900"), ("Q7", "Q900")])
        current = self.discover([("Q20", qid) for qid in ("Q100", "Q200", "Q300", "Q900")])
        self.retire(current)

        self.assertEqual(self.candidates(previous), [("Q20", "Q900", "accepted"), ("Q7", "Q900", "stale")])
        self.assert_release("Q900", "accepted")

    def test_shared_release_below_the_cut_is_retired_in_both_groups(self):
        previous = self.discover([("Q20", "Q150"), ("Q7", "Q150")])
        current = self.discover([("Q20", qid) for qid in ("Q100", "Q200", "Q300", "Q400")])
        self.retire(current)

        self.assertEqual(self.candidates(previous), [("Q20", "Q150", "stale"), ("Q7", "Q150", "stale")])
        self.assert_release("Q150", "stale")

    def test_complete_discovery_after_a_cut_retires_missing_releases(self):
        previous = self.discover([("Q20", qid) for qid in ("Q100", "Q200", "Q300", "Q400")])
        current = self.discover([("Q20", "Q200"), ("Q20", "Q300")])
        self.retire(current)

        self.assertEqual(
            self.candidates(previous),
            [("Q20", "Q100", "stale"), ("Q20", "Q200", "accepted"), ("Q20", "Q300", "accepted")],
        )
        self.assert_release("Q100", "stale")
        self.assert_release("Q200", "accepted")


if __name__ == "__main__":
    unittest.main()
