"""The person-infobox rule is opt-in, safe by default and never downgrades (ADR 027).

Every test runs offline on databases copied from one baseline, so the same
starting point is run with and without the option and the results compared.
"""

import contextlib
import copy
import io
import json
import re
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from kpop_scraping.cli import DEFAULT_DATABASE, build_parser, main
from kpop_scraping.fact_pipeline import extract_facts
from kpop_scraping.person_preservation import PersonEvidenceUnavailable
from kpop_scraping.storage import Repository

from tests.test_person_pages import PAGES, FixturePersonClient
from tests.wikidata_fixture import SUNYE, WENDY, YERI, FixtureWikidataClient, build_catalog, load_fixture

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
INFOBOX_FACTS = {(YERI, "born_on"), (WENDY, "born_on"), (WENDY, "born_in")}


class ToleratingPersonClient(FixturePersonClient):
    """Serves the person pages and nothing else when it also stands in for the group wikitext."""

    def get_revision_wikitext(self, revision_ids):
        known = {spec["revid"] for spec in self.pages.values()}
        return super().get_revision_wikitext([r for r in revision_ids if r in known])


@contextlib.contextmanager
def database(path):
    connection = sqlite3.connect(path, isolation_level=None)
    try:
        yield connection
    finally:
        connection.close()


def facts(path):
    """Status, reason, flags and evidence of every birth fact, keyed by subject and predicate."""
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT e.wikidata_id, f.predicate, f.status, f.status_reason,
                   f.quality_flags_json, fe.locator
            FROM facts f JOIN entities e ON e.id = f.subject_entity_id
            LEFT JOIN fact_evidence fe ON fe.fact_id = f.id
            WHERE f.predicate IN ('born_on', 'born_in')
            ORDER BY e.wikidata_id, f.predicate, fe.locator
            """
        ).fetchall()
    finally:
        connection.close()
    return {
        (row["wikidata_id"], row["predicate"]): (
            row["status"], row["status_reason"], row["quality_flags_json"], row["locator"]
        )
        for row in rows
    }


def accepted(snapshot):
    """Subject, predicate, evidence and flags of the accepted facts; their reasons do not exist."""
    return {key: value for key, value in snapshot.items() if value[0] == "accepted"}


def accepted_by_page(snapshot):
    return {key for key, value in snapshot.items() if value[0] == "accepted" and value[3]}


class GateTestCase(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.base = self.root / "base"
        self.base.mkdir()
        with Repository(self.base / "kpop.db", raw_dir=self.base / "raw") as repository:
            build_catalog(repository, self.fixture)
            extract_facts(repository, FixtureWikidataClient(self.fixture))
        self.baseline = facts(self.base / "kpop.db")

    def copy_of(self, source, name):
        target = self.root / name
        shutil.copytree(source, target)
        return target

    def run_facts(self, directory, person_client=None, fixture=None):
        with Repository(directory / "kpop.db", raw_dir=directory / "raw") as repository:
            return extract_facts(
                repository,
                FixtureWikidataClient(fixture or self.fixture),
                person_client=person_client,
            )

    def opted_in(self, name="opted-in"):
        copy_dir = self.copy_of(self.base, name)
        self.totals = self.run_facts(copy_dir, FixturePersonClient())
        return copy_dir


class BeforeAndAfterTest(GateTestCase):
    def test_baseline_accepts_nothing_from_a_person_page(self):
        self.assertEqual(accepted_by_page(self.baseline), set())
        self.assertNotIn("accepted", {value[0] for value in self.baseline.values()})

    def test_opt_in_on_a_copy_accepts_and_reports_before_and_after_coverage(self):
        copy_dir = self.opted_in()
        after = facts(copy_dir / "kpop.db")
        before_rows = {row.predicate: row for row in self.totals.birth_before}
        after_rows = {row.predicate: row for row in self.totals.birth_after}
        self.assertEqual(accepted_by_page(after), INFOBOX_FACTS)
        self.assertEqual(
            (before_rows["born_on"].accepted, before_rows["born_on"].accepted_by_person_page),
            (0, 0),
        )
        self.assertEqual(after_rows["born_on"].accepted_by_person_page, 2)
        self.assertEqual(after_rows["born_in"].accepted_by_person_page, 1)
        self.assertGreater(after_rows["born_on"].accepted, before_rows["born_on"].accepted)
        self.assertGreater(after_rows["born_on"].rejected_by_person_page, 0)
        # The baseline database is a different file and did not move.
        self.assertEqual(facts(self.base / "kpop.db"), self.baseline)

    def test_run_without_the_option_on_the_baseline_changes_nothing(self):
        copy_dir = self.copy_of(self.base, "default")
        totals = self.run_facts(copy_dir)
        self.assertEqual(facts(copy_dir / "kpop.db"), self.baseline)
        self.assertEqual(totals.birth_before, totals.birth_after)
        with database(copy_dir / "kpop.db") as connection:
            pages = connection.execute("SELECT COUNT(*) FROM person_source_pages").fetchone()[0]
        self.assertEqual(pages, 0)

    def test_later_run_without_the_option_keeps_every_accepted_fact_and_uses_no_network(self):
        opted_in = self.opted_in()
        audited = facts(opted_in / "kpop.db")
        later = self.copy_of(opted_in, "later")
        with patch("socket.socket.connect", side_effect=AssertionError("network used")):
            totals = self.run_facts(later)
        # Accepted facts keep status, flags and evidence. A fact the page rejected
        # stays rejected and only falls back to the reason it had before the rule.
        self.assertEqual(accepted(facts(later / "kpop.db")), accepted(audited))
        self.assertEqual(
            {key for key, value in facts(later / "kpop.db").items() if value[0] == "rejected"},
            {key for key, value in audited.items() if value[0] == "rejected"},
        )
        self.assertEqual(
            facts(later / "kpop.db")[(SUNYE, "born_on")][:2], ("rejected", "missing_evidence")
        )
        self.assertEqual(accepted_by_page(facts(later / "kpop.db")), INFOBOX_FACTS)
        self.assertEqual(
            [(row.accepted, row.accepted_by_person_page) for row in totals.birth_before],
            [(row.accepted, row.accepted_by_person_page) for row in totals.birth_after],
        )
        self.assertEqual(totals.birth_after[0].accepted_by_person_page, 2)

    def test_repeating_the_run_without_the_option_is_stable(self):
        opted_in = self.opted_in()
        self.run_facts(opted_in)
        once = facts(opted_in / "kpop.db")
        self.run_facts(opted_in)
        self.assertEqual(facts(opted_in / "kpop.db"), once)

    def test_option_off_does_not_collect_or_accept_a_new_statement_from_a_stored_page(self):
        opted_in = self.opted_in()
        later = self.copy_of(opted_in, "later")
        # Wendy's born_in looks like a statement the rule never accepted.
        with database(later / "kpop.db") as connection:
            fact_id = connection.execute(
                """
                SELECT f.id FROM facts f JOIN entities e ON e.id = f.subject_entity_id
                WHERE e.wikidata_id = ? AND f.predicate = 'born_in'
                """,
                (WENDY,),
            ).fetchone()[0]
            connection.execute("DELETE FROM fact_evidence WHERE fact_id = ?", (fact_id,))
            connection.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
        self.run_facts(later)
        after = facts(later / "kpop.db")
        self.assertEqual(after[(WENDY, "born_in")][:2], ("rejected", "missing_evidence"))
        self.assertIsNone(after[(WENDY, "born_in")][3])
        self.assertEqual(after[(WENDY, "born_on")][0], "accepted")
        self.assertEqual(after[(YERI, "born_on")][0], "accepted")

    def test_a_changed_wikidata_value_is_not_a_downgrade(self):
        opted_in = self.opted_in()
        changed = copy.deepcopy(self.fixture)
        changed["subject_profile"][YERI]["lastrevid"] += 1
        claim = changed["subject_profile"][YERI]["claims"]["P569"][0]
        claim["mainsnak"]["datavalue"]["value"]["time"] = "+1999-03-06T00:00:00Z"
        claim["references"] = []
        self.run_facts(opted_in, fixture=changed)
        after = facts(opted_in / "kpop.db")
        self.assertEqual(after[(YERI, "born_on")][:2], ("rejected", "wikipedia_value_differs"))

    def test_a_new_page_revision_changes_a_fact_only_when_the_option_is_on(self):
        opted_in = self.opted_in()
        edited = {title: dict(spec) for title, spec in PAGES.items()}
        edited["Yeri (singer)"].update(
            revid=91103,
            wikitext=PAGES["Yeri (singer)"]["wikitext"].replace("|1999|3|5", "|1999|3|6"),
        )
        off = self.copy_of(opted_in, "off")
        self.run_facts(off)
        self.assertEqual(facts(off / "kpop.db")[(YERI, "born_on")][0], "accepted")
        self.run_facts(opted_in, ToleratingPersonClient(edited))
        self.assertEqual(
            facts(opted_in / "kpop.db")[(YERI, "born_on")][:2],
            ("rejected", "wikipedia_value_differs"),
        )


class FailClosedTest(GateTestCase):
    def assertRefused(self, directory, pattern):
        before = facts(directory / "kpop.db")
        with self.assertRaisesRegex(PersonEvidenceUnavailable, pattern):
            self.run_facts(directory)
        self.assertEqual(facts(directory / "kpop.db"), before)
        with database(directory / "kpop.db") as connection:
            last = connection.execute(
                "SELECT status FROM fact_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
        self.assertEqual(last, "failed")

    def test_lost_wikitext_snapshot_fails_the_run_and_keeps_the_facts(self):
        directory = self.opted_in()
        with database(directory / "kpop.db") as connection:
            paths = [
                row[0]
                for row in connection.execute(
                    """
                    SELECT w.snapshot_path FROM source_revision_wikitext w
                    JOIN source_revisions sr ON sr.id = w.source_revision_id
                    WHERE sr.external_revision_id = 91003
                    """
                )
            ]
        self.assertEqual(len(paths), 1)
        (directory / "raw" / paths[0]).unlink()
        self.assertRefused(directory, "cannot be read")

    def test_missing_wikitext_row_fails_the_run(self):
        directory = self.opted_in()
        with database(directory / "kpop.db") as connection:
            connection.execute(
                """
                DELETE FROM source_revision_wikitext WHERE source_revision_id IN (
                    SELECT id FROM source_revisions WHERE external_revision_id = 91003)
                """
            )
        self.assertRefused(directory, "is not stored")

    def test_identity_that_no_longer_holds_fails_instead_of_downgrading(self):
        directory = self.opted_in()
        with database(directory / "kpop.db") as connection:
            connection.execute("UPDATE source_pages SET is_redirect = 1 WHERE external_page_id = 9003")
        self.assertRefused(directory, "would lose their evidence")

    def test_two_revisions_for_one_person_fail_the_run(self):
        directory = self.opted_in()
        with database(directory / "kpop.db") as connection:
            other = connection.execute(
                "SELECT id FROM source_revisions WHERE external_revision_id = 91001"
            ).fetchone()[0]
            connection.execute(
                """
                UPDATE fact_evidence SET source_revision_id = ?
                WHERE fact_id = (SELECT f.id FROM facts f JOIN entities e ON e.id = f.subject_entity_id
                                 WHERE e.wikidata_id = ? AND f.predicate = 'born_on')
                """,
                (other, WENDY),
            )
        self.assertRefused(directory, "two page revisions")

    def test_the_same_run_with_the_option_on_does_not_fail(self):
        directory = self.opted_in()
        with database(directory / "kpop.db") as connection:
            connection.execute("UPDATE source_pages SET is_redirect = 1 WHERE external_page_id = 9003")
        self.run_facts(directory, FixturePersonClient())
        self.assertEqual(facts(directory / "kpop.db")[(YERI, "born_on")][0], "accepted")


class CliActivationTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.database = self.root / "copy" / "kpop.db"

    def run_main(self, arguments, environment=None):
        fact_totals = MagicMock(birth_before=(), birth_after=())
        patches = [
            patch("kpop_scraping.cli.Repository"),
            patch("kpop_scraping.cli.collect_category", return_value=0),
            patch("kpop_scraping.cli.classify_catalog"),
            patch("kpop_scraping.cli.extract_facts", return_value=fact_totals),
            patch("kpop_scraping.cli.export_fact_coverage_csv", return_value=0),
            patch("kpop_scraping.cli.discover_releases"),
            patch("kpop_scraping.cli.collect_release_facts"),
            patch("kpop_scraping.cli.export_release_coverage_csv", return_value=0),
            patch("kpop_scraping.cli.MediaWikiClient"),
            patch.dict("os.environ", environment or {}),
        ]
        with contextlib.ExitStack() as stack:
            mocks = [stack.enter_context(p) for p in patches]
            with contextlib.redirect_stdout(io.StringIO()):
                code = main(arguments)
        self.assertEqual(code, 0)
        return mocks[3]

    def test_person_pages_are_off_unless_the_flag_is_given(self):
        for arguments in (
            ["--facts"],
            ["--releases"],
            ["--facts", "--releases"],
            ["--facts-limit", "3"],
            ["--facts-report", "facts.csv"],
            ["--release-report", "releases.csv"],
        ):
            with self.subTest(arguments=arguments):
                extract = self.run_main(["--database", str(self.database), *arguments])
                self.assertIsNone(extract.call_args.kwargs["person_client"])

    def test_environment_does_not_activate_it(self):
        names = {
            "PERSON_EVIDENCE": "1",
            "KPOP_PERSON_EVIDENCE": "true",
            "KPOP_QUIZ_PERSON_EVIDENCE": "1",
            "QUIZ_PERSON_EVIDENCE": "true",
        }
        extract = self.run_main(["--database", str(self.database), "--facts", "--releases"], names)
        self.assertIsNone(extract.call_args.kwargs["person_client"])

    def test_the_flag_activates_it_on_a_copy_with_or_without_releases(self):
        for arguments in (["--facts"], ["--releases"], ["--facts-limit", "2"]):
            with self.subTest(arguments=arguments):
                extract = self.run_main(
                    ["--database", str(self.database), "--person-evidence", *arguments]
                )
                self.assertIsNotNone(extract.call_args.kwargs["person_client"])

    def test_the_flag_is_refused_on_the_default_database_and_raw_directory(self):
        for arguments in (
            ["--facts", "--person-evidence"],
            ["--facts", "--person-evidence", "--database", str(DEFAULT_DATABASE)],
            ["--facts", "--person-evidence", "--database", str(self.database), "--raw-dir",
             str(DEFAULT_DATABASE.parent / "raw")],
        ):
            with self.subTest(arguments=arguments), patch(
                "kpop_scraping.cli.Repository"
            ) as repository, patch("kpop_scraping.cli.extract_facts") as extract:
                with self.assertRaisesRegex(SystemExit, "refuses the default paths"):
                    main(arguments)
                repository.assert_not_called()
                extract.assert_not_called()

    def test_the_flag_needs_the_fact_stage(self):
        with self.assertRaisesRegex(SystemExit, "needs the fact stage"):
            main(["--database", str(self.database), "--person-evidence"])

    def test_the_scheduled_workflow_neither_passes_the_flag_nor_configures_it(self):
        text = "\n".join(path.read_text(encoding="utf-8") for path in WORKFLOWS.glob("*.yml"))
        self.assertNotRegex(text, r"(?i)person[-_]evidence")
        cron = (WORKFLOWS / "daily-puzzles-cron.yml").read_text(encoding="utf-8")
        command = re.search(r"python main\.py ([^;\n]*)", cron)
        self.assertIsNotNone(command)
        arguments = build_parser().parse_args(command.group(1).split())
        self.assertTrue(arguments.facts and arguments.releases)
        self.assertFalse(arguments.person_evidence)


class CliEndToEndTest(GateTestCase):
    """main() on database copies, with every client replaced by an offline fake."""

    def run_cli(self, directory, *flags):
        output = io.StringIO()
        release_totals = MagicMock(groups=0, entities=0, accepted=0, rejected=0, conflict=0)
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch("kpop_scraping.cli.collect_category", return_value=0))
            classify = stack.enter_context(patch("kpop_scraping.cli.classify_catalog"))
            classify.return_value.accepted = classify.return_value.rejected = 0
            classify.return_value.pending = 0
            stack.enter_context(
                patch("kpop_scraping.cli.WikidataEntityClient", lambda **_: FixtureWikidataClient(self.fixture))
            )
            stack.enter_context(patch("kpop_scraping.cli.WikidataTypeClient"))
            stack.enter_context(patch("kpop_scraping.cli.WikidataQueryClient"))
            stack.enter_context(patch("kpop_scraping.cli.discover_releases"))
            stack.enter_context(patch("kpop_scraping.cli.export_release_coverage_csv", return_value=0))
            stack.enter_context(
                patch("kpop_scraping.cli.collect_release_facts", return_value=release_totals)
            )
            stack.enter_context(
                patch("kpop_scraping.cli.MediaWikiClient", lambda **_: ToleratingPersonClient())
            )
            with contextlib.redirect_stdout(output):
                code = main(
                    ["--database", str(directory / "kpop.db"), "--raw-dir", str(directory / "raw"), *flags]
                )
        return code, output.getvalue()

    def test_cron_command_then_opt_in_on_a_copy_then_cron_command_again(self):
        # What the cron does today, on the database it restored.
        cron = self.copy_of(self.base, "cron")
        code, output = self.run_cli(cron, "--facts", "--releases")
        self.assertEqual(code, 0, output)
        self.assertEqual(facts(cron / "kpop.db"), self.baseline)
        self.assertIn("born_on: 0/6 accepted (0 by person page)", output)
        self.assertNotIn("-> 2/6", output)

        # C-03 on an explicit copy.
        audit = self.copy_of(self.base, "audit")
        code, output = self.run_cli(audit, "--facts", "--releases", "--person-evidence")
        self.assertEqual(code, 0)
        self.assertEqual(accepted_by_page(facts(audit / "kpop.db")), INFOBOX_FACTS)
        self.assertIn("born_on: 0/6 accepted (0 by person page)", output)
        self.assertIn("-> 2/6 accepted (2 by person page)", output)
        self.assertIn("born_in: 0/3 accepted (0 by person page)", output)
        self.assertIn("-> 1/3 accepted (1 by person page)", output)
        self.assertEqual(facts(cron / "kpop.db"), self.baseline)

        # The default command on the audited copy keeps what the audit accepted.
        audited = facts(audit / "kpop.db")
        with patch("socket.socket.connect", side_effect=AssertionError("network used")):
            code, output = self.run_cli(audit, "--facts", "--releases")
        self.assertEqual(code, 0)
        self.assertEqual(accepted(facts(audit / "kpop.db")), accepted(audited))
        self.assertIn("born_on: 2/6 accepted (2 by person page)", output)
        self.assertIn("-> 2/6 accepted (2 by person page)", output)

    def test_default_command_on_an_audited_copy_fails_closed_when_evidence_is_lost(self):
        audit = self.copy_of(self.base, "audit")
        self.run_cli(audit, "--facts", "--person-evidence")
        audited = facts(audit / "kpop.db")
        with database(audit / "kpop.db") as connection:
            connection.execute("DELETE FROM source_revision_wikitext")
        code, output = self.run_cli(audit, "--facts", "--releases")
        self.assertEqual(code, 1)
        self.assertIn("Pipeline failed: PersonEvidenceUnavailable", output)
        self.assertEqual(facts(audit / "kpop.db"), audited)


if __name__ == "__main__":
    unittest.main()
