import csv
import json
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.catalog import CLASSIFIER_VERSION, classify_catalog
from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import Page
from kpop_scraping.storage import Repository, SnapshotIntegrityError
from kpop_scraping.wikidata import TypeCheck


FIXTURE = Path(__file__).parent / "fixtures" / "catalog_cases.json"


class FixtureClient:
    provider = "wikipedia"
    language = "en"

    def __init__(self, cases):
        self.cases = cases

    def iter_category_members(self, _category):
        for case in self.cases:
            yield {"pageid": case["page_id"], "title": case["title"]}

    def get_pages(self, page_ids):
        selected = {case["page_id"]: case for case in self.cases}
        return [
            Page(
                page_id=page_id,
                title=selected[page_id]["title"],
                canonical_url=f"https://example.test/{page_id}",
                extract="Text",
                revision_id=100 + page_id,
                wikidata_id=selected[page_id].get("wikidata_id"),
                is_redirect=selected[page_id].get("is_redirect", False),
                is_disambiguation=selected[page_id].get("is_disambiguation", False),
            )
            for page_id in page_ids
        ]


class TypeClient:
    def __init__(self, cases):
        self.cases = {case["wikidata_id"]: case for case in cases if case["wikidata_id"]}
        self.requests = []

    def get_type_checks(self, wikidata_ids):
        self.requests.append(tuple(wikidata_ids))
        for wikidata_id in wikidata_ids:
            case = self.cases.get(wikidata_id)
            if case is not None:
                yield TypeCheck(wikidata_id, 1000 + case["page_id"], tuple(case["instance_of"]))


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_fixture_classification_is_deterministic_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient(self.cases), repository, "Category:Test")
                client = TypeClient(self.cases)
                stats = classify_catalog(repository, client)
                decisions = repository.connection.execute(
                    """
                    SELECT sp.external_page_id, ce.state, ce.rejection_reason,
                           ce.classifier_version, ce.source_revision_id
                    FROM catalog_entries ce
                    JOIN source_pages sp ON sp.id = ce.source_page_id
                    ORDER BY sp.external_page_id
                    """
                ).fetchall()
                second_stats = classify_catalog(repository, client)
                entry_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries"
                ).fetchone()[0]
                rejection_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries WHERE state='rejected'"
                ).fetchone()[0]
                catalog_runs = repository.connection.execute(
                    "SELECT status FROM catalog_runs ORDER BY id"
                ).fetchall()

            expected = [
                (case["page_id"], case["expected_state"], case["expected_reason"])
                for case in self.cases
            ]
            actual = [
                (row["external_page_id"], row["state"], row["rejection_reason"])
                for row in decisions
            ]
            self.assertEqual(actual, expected)
            self.assertTrue(all(row["classifier_version"] == CLASSIFIER_VERSION for row in decisions))
            self.assertEqual(stats.accepted, 1)
            self.assertEqual(stats.rejected, 5)
            self.assertEqual(second_stats.accepted, 1)
            self.assertEqual(second_stats.rejected, 5)
            self.assertEqual(entry_count, len(self.cases))
            self.assertEqual(rejection_count, 5)
            self.assertEqual(client.requests, [("Q1", "Q5"), ("Q1", "Q5")])
            self.assertEqual(
                [row["status"] for row in catalog_runs],
                ["completed", "completed"],
            )

    def test_report_contains_decision_revision_and_type_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "reports" / "catalog.csv"
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient(self.cases), repository, "Category:Test")
                classify_catalog(repository, TypeClient(self.cases))
                count = repository.export_catalog_csv(report)

            with report.open(encoding="utf-8", newline="") as report_file:
                rows = list(csv.DictReader(report_file))
            accepted = next(row for row in rows if row["state"] == "accepted")
            self.assertEqual(count, len(self.cases))
            self.assertEqual(accepted["wikidata_id"], "Q1")
            self.assertEqual(accepted["wikidata_revision_id"], "1001")
            self.assertEqual(json.loads(accepted["instance_of_json"]), ["Q9212979"])

    def test_new_source_revision_returns_entry_to_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient(self.cases[:1]), repository, "Category:Test")
                classify_catalog(repository, TypeClient(self.cases))
                changed = dict(self.cases[0])
                client = FixtureClient([changed])
                original_get_pages = client.get_pages

                def revised(page_ids):
                    page = original_get_pages(page_ids)[0]
                    return [Page(**{**page.__dict__, "revision_id": 999})]

                client.get_pages = revised
                collect_category(client, repository, "Category:Test")
                state = repository.connection.execute(
                    "SELECT state FROM catalog_entries"
                ).fetchone()["state"]
                entry_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries"
                ).fetchone()[0]

            self.assertEqual(state, "candidate")
            self.assertEqual(entry_count, 1)

    def test_changed_qid_returns_same_source_revision_to_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient(self.cases[:1]), repository, "Category:Test")
                classify_catalog(repository, TypeClient(self.cases))
                changed = {**self.cases[0], "wikidata_id": "Q99"}
                collect_category(FixtureClient([changed]), repository, "Category:Test")
                entry = repository.connection.execute(
                    "SELECT state, analyzed_wikidata_id FROM catalog_entries"
                ).fetchone()

            self.assertEqual(entry["state"], "candidate")
            self.assertEqual(entry["analyzed_wikidata_id"], "Q99")

    def test_changed_page_property_returns_same_source_revision_to_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient(self.cases[:1]), repository, "Category:Test")
                classify_catalog(repository, TypeClient(self.cases))
                changed = {**self.cases[0], "is_disambiguation": True}
                collect_category(FixtureClient([changed]), repository, "Category:Test")
                entry = repository.connection.execute(
                    "SELECT state FROM catalog_entries"
                ).fetchone()

            self.assertEqual(entry["state"], "candidate")

    def test_same_wikidata_revision_cannot_change_p31(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                repository.save_type_check("Q1", 77, ["Q215380"])
                with self.assertRaisesRegex(SnapshotIntegrityError, "changed P31"):
                    repository.save_type_check("Q1", 77, ["Q5"])

    def test_remote_failure_rolls_back_local_rejections(self):
        class FailingTypeClient:
            def get_type_checks(self, _wikidata_ids):
                raise RuntimeError("Wikidata unavailable")

        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(FixtureClient(self.cases[:2]), repository, "Category:Test")
                with self.assertRaisesRegex(RuntimeError, "Wikidata unavailable"):
                    classify_catalog(repository, FailingTypeClient())
                states = repository.connection.execute(
                    "SELECT state FROM catalog_entries ORDER BY source_page_id"
                ).fetchall()
                run = repository.connection.execute(
                    "SELECT status, error FROM catalog_runs"
                ).fetchone()

            self.assertEqual([row["state"] for row in states], ["candidate", "candidate"])
            self.assertEqual(run["status"], "failed")
            self.assertIn("Wikidata unavailable", run["error"])

    def test_missing_page_records_collection_issue_without_catalog_entry(self):
        class MissingClient:
            def iter_category_members(self, _category):
                yield {"pageid": 99, "title": "Deleted"}

            def get_pages(self, _page_ids):
                return [Page(99, "Deleted", "", "", None, is_missing=True)]

        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                self.assertEqual(collect_category(MissingClient(), repository, "Category:Test"), 0)
                issue = repository.connection.execute(
                    "SELECT issue_code FROM collection_issues"
                ).fetchone()
                entries = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries"
                ).fetchone()[0]
            self.assertEqual(issue["issue_code"], "missing_page")
            self.assertEqual(entries, 0)

    def test_report_neutralizes_spreadsheet_formulas_from_external_text(self):
        malicious_case = {
            "page_id": 77,
            "title": "=HYPERLINK(\"https://example.test\")",
            "wikidata_id": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "catalog.csv"
            with Repository(root / "test.db") as repository:
                collect_category(FixtureClient([malicious_case]), repository, "Category:Test")
                classify_catalog(repository, TypeClient([malicious_case]))
                repository.export_catalog_csv(report)

            with report.open(encoding="utf-8", newline="") as report_file:
                row = next(csv.DictReader(report_file))

            self.assertEqual(row["title"], "'=HYPERLINK(\"https://example.test\")")


if __name__ == "__main__":
    unittest.main()
