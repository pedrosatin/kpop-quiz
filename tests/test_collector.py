import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import Page
from kpop_scraping.storage import Repository


class FakeClient:
    def iter_category_members(self, _category):
        yield {"pageid": 10, "title": "Alpha"}
        yield {"pageid": 20, "title": "Beta"}

    def get_pages(self, page_ids):
        return [
            Page(
                page_id,
                f"Group {page_id}",
                f"https://example.test/{page_id}",
                "Text",
                7,
            )
            for page_id in page_ids
        ]


class FailingSecondBatchClient:
    def __init__(self, extract):
        self.extract = extract
        self.calls = 0

    def iter_category_members(self, _category):
        for page_id in range(1, 22):
            yield {"pageid": page_id, "title": f"Group {page_id}"}

    def get_pages(self, page_ids):
        self.calls += 1
        if self.calls == 2:
            raise RuntimeError("second batch failed")
        revision_id = 7 if self.extract == "old" else 8
        return [
            Page(
                page_id,
                f"Group {page_id}",
                f"https://example.test/{page_id}",
                self.extract,
                revision_id,
            )
            for page_id in page_ids
        ]


class RecordingBatchClient:
    def __init__(self):
        self.batch_sizes = []

    def iter_category_members(self, _category):
        for page_id in range(1, 22):
            yield {"pageid": page_id, "title": f"Group {page_id}"}

    def get_pages(self, page_ids):
        self.batch_sizes.append(len(page_ids))
        return [
            Page(
                page_id,
                f"Group {page_id}",
                f"https://example.test/{page_id}",
                "text",
                7,
            )
            for page_id in page_ids
        ]


class CollectorTest(unittest.TestCase):
    def test_collects_and_upserts_pages_with_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                self.assertEqual(collect_category(FakeClient(), repository, "Category:Test"), 2)
                self.assertEqual(collect_category(FakeClient(), repository, "Category:Test"), 2)
                page_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_pages"
                ).fetchone()[0]
                runs = repository.connection.execute(
                    "SELECT status, pages_collected FROM collection_runs ORDER BY id"
                ).fetchall()
        self.assertEqual(page_count, 2)
        self.assertEqual([(row["status"], row["pages_collected"]) for row in runs], [("completed", 2), ("completed", 2)])

    def test_limit_is_applied_before_page_details_are_fetched(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                count = collect_category(FakeClient(), repository, "Category:Test", limit=1)
                titles = repository.connection.execute("SELECT title FROM source_pages").fetchall()
        self.assertEqual(count, 1)
        self.assertEqual([row["title"] for row in titles], ["Group 10"])

    def test_fetches_details_in_batches_supported_by_text_extracts(self):
        client = RecordingBatchClient()
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(client, repository, "Category:Test")

        self.assertEqual(client.batch_sizes, [20, 1])

    def test_failed_run_rolls_back_page_changes_and_records_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(FailingSecondBatchClient("old"), repository, "Category:Test", limit=20)
                with self.assertRaisesRegex(RuntimeError, "second batch failed"):
                    collect_category(FailingSecondBatchClient("new"), repository, "Category:Test")
                extracts = repository.connection.execute(
                    "SELECT DISTINCT extract FROM source_pages"
                ).fetchall()
                failed = repository.connection.execute(
                    "SELECT status, error FROM collection_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()
        self.assertEqual([row["extract"] for row in extracts], ["old"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("second batch failed", failed["error"])

    def test_snapshot_write_failure_rolls_back_database_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                with patch.object(repository.snapshots, "write", side_effect=OSError("disk full")):
                    with self.assertRaisesRegex(OSError, "disk full"):
                        collect_category(FakeClient(), repository, "Category:Test", limit=1)
                page_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_pages"
                ).fetchone()[0]
                revision_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0]
                run = repository.connection.execute(
                    "SELECT status, error FROM collection_runs"
                ).fetchone()
        self.assertEqual(page_count, 0)
        self.assertEqual(revision_count, 0)
        self.assertEqual(run["status"], "failed")
        self.assertIn("disk full", run["error"])
