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
)
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
        self.assertEqual(truncated, (TruncatedGroup("Q1", 5, 3),))
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
        self.assertEqual(truncated, (TruncatedGroup("Q1", 3, 2),))

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

    def test_order_is_numeric_for_long_and_zero_padded_qids(self):
        # 5000 digits: int() refuses strings above 4300 digits.
        huge = "Q" + "9" * 5000
        body = wdqs_body([("Q1", qid) for qid in (huge, "Q0", "Q007", "Q7", "Q70", "Q8")])

        releases, truncated = _parse_results(body, {"Q1"}, 5)

        self.assertEqual([item.release_id for item in releases], ["Q0", "Q007", "Q7", "Q8", "Q70"])
        self.assertEqual(truncated, (TruncatedGroup("Q1", 6, 5),))

    def test_release_qid_needs_ascii_digits(self):
        # str.isdigit() accepts these digits; the numeric order handles only 0 to 9.
        for release in ("Q²", "Q١٢", "Q", "P5", "Q5x"):
            with self.subTest(release), self.assertRaisesRegex(MediaWikiError, "unexpected entity"):
                _parse_results(wdqs_body([("Q1", release)]), {"Q1"}, 100)

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
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute("UPDATE release_discovery_groups SET candidates_discarded=-1")
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
                """SELECT e.wikidata_id,rdg.candidates_discarded FROM release_discovery_groups rdg
                JOIN entities e ON e.id=rdg.group_entity_id ORDER BY e.wikidata_id"""
            ),
            [("Q20", 3), ("Q7", 0)],
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


if __name__ == "__main__":
    unittest.main()
