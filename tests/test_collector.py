import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import MAX_EXTRACT_BYTES, Page
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


class ExtractSizeClient:
    """Serve page 10 with an extract of the given size and page 20 with a short one."""

    def __init__(self, size, revision_id=7):
        self.size = size
        self.revision_id = revision_id

    def iter_category_members(self, _category):
        yield {"pageid": 10, "title": "Alpha"}
        yield {"pageid": 20, "title": "Beta"}

    def get_pages(self, page_ids):
        lead = "Alpha is a South Korean girl group. "
        extracts = {10: lead + "a" * (self.size - len(lead)), 20: "Beta is a group."}
        return [
            Page(
                page_id,
                f"Group {page_id}",
                f"https://example.test/{page_id}",
                extracts[page_id],
                self.revision_id,
            )
            for page_id in page_ids
        ]


class RevisionAwareClient:
    """Category of pages 1..25; ``revisions`` maps page ID to its current revision."""

    provider = "wikipedia"
    language = "en"

    def __init__(self, revisions, answer_reversed=False):
        self.revisions = revisions
        self.answer_reversed = answer_reversed
        self.revision_calls = []
        self.page_calls = []

    def iter_category_members(self, _category):
        for page_id in self.revisions:
            yield {"pageid": page_id, "title": f"Group {page_id}"}

    def _page(self, page_id, extract):
        revision_id = self.revisions[page_id]
        return Page(
            page_id, f"Group {page_id}", f"https://example.test/{page_id}", extract, revision_id,
            source_payload=None if not extract else {
                "pageid": page_id, "title": f"Group {page_id}", "extract": extract,
                "revisions": [{"revid": revision_id}],
            },
            wikidata_id=f"Q{page_id}",
        )

    def get_page_revisions(self, page_ids):
        self.revision_calls.append(list(page_ids))
        return [self._page(page_id, "") for page_id in page_ids]

    def get_pages(self, page_ids):
        self.page_calls.append(list(page_ids))
        pages = [self._page(page_id, f"Text of revision {self.revisions[page_id]}.") for page_id in page_ids]
        return pages[::-1] if self.answer_reversed else pages


class CollectorTest(unittest.TestCase):
    def test_incremental_collection_downloads_only_revisions_not_stored(self):
        revisions = {page_id: 100 + page_id for page_id in range(1, 26)}
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(RevisionAwareClient(revisions), repository, "Category:Test")
                revisions[3] += 1000
                revisions[24] += 1000
                client = RevisionAwareClient(revisions)
                count = collect_category(client, repository, "Category:Test", incremental=True)
                rows = repository.connection.execute(
                    "SELECT external_page_id, revision_id, extract FROM source_pages ORDER BY external_page_id"
                ).fetchall()
                linked = repository.connection.execute(
                    "SELECT COUNT(*) FROM collection_run_revisions WHERE collection_run_id=2"
                ).fetchone()[0]
        self.assertEqual(count, 25)
        self.assertEqual(client.revision_calls, [list(range(1, 26))])
        self.assertEqual(client.page_calls, [[3, 24]])
        self.assertEqual(rows[2]["revision_id"], 1103)
        self.assertEqual(rows[2]["extract"], "Text of revision 1103.")
        self.assertEqual(rows[0]["extract"], "Text of revision 101.")
        self.assertEqual(linked, 25)

    def test_pages_are_saved_in_category_order_whatever_the_answer_order(self):
        revisions = {page_id: 100 + page_id for page_id in (30, 10, 20)}
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(
                    RevisionAwareClient(revisions, answer_reversed=True), repository, "Category:Test"
                )
                order = [row[0] for row in repository.connection.execute(
                    "SELECT external_page_id FROM source_pages ORDER BY id"
                )]
        self.assertEqual(order, [30, 10, 20])

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

    def test_extract_of_33_kib_is_recorded_as_issue_and_the_run_continues(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db", raw_dir=root / "raw") as repository:
                count = collect_category(ExtractSizeClient(33 * 1024), repository, "Category:Test")
                issues = repository.connection.execute(
                    "SELECT external_page_id, title, issue_code, detail FROM collection_issues"
                ).fetchall()
                pages = repository.connection.execute(
                    "SELECT external_page_id FROM source_pages"
                ).fetchall()
                entries = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries"
                ).fetchone()[0]
                run = repository.connection.execute(
                    "SELECT status, pages_collected FROM collection_runs"
                ).fetchone()
            snapshots = [path for path in (root / "raw").rglob("*") if path.is_file()]
        self.assertEqual(count, 1)
        self.assertEqual(
            [tuple(issue) for issue in issues],
            [(
                10, "Group 10", "page_extract_oversize",
                f"Extract of revision 7 has {33 * 1024} UTF-8 bytes; the limit is {MAX_EXTRACT_BYTES}",
            )],
        )
        # Only the short page left a page row, a catalog entry and a snapshot.
        self.assertEqual([row["external_page_id"] for row in pages], [20])
        self.assertEqual(entries, 1)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(tuple(run), ("completed", 1))

    def test_extract_of_31_kib_is_collected(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                count = collect_category(ExtractSizeClient(31 * 1024), repository, "Category:Test")
                issues = repository.connection.execute(
                    "SELECT COUNT(*) FROM collection_issues"
                ).fetchone()[0]
                stored = repository.connection.execute(
                    "SELECT length(CAST(extract AS BLOB)) FROM source_pages WHERE external_page_id=10"
                ).fetchone()[0]
                entries = repository.connection.execute(
                    "SELECT COUNT(*) FROM catalog_entries"
                ).fetchone()[0]
        self.assertEqual((count, issues, stored, entries), (2, 0, 31 * 1024, 2))

    def test_oversize_revision_leaves_the_revision_collected_before_in_place(self):
        with tempfile.TemporaryDirectory() as directory:
            with Repository(Path(directory) / "test.db") as repository:
                collect_category(ExtractSizeClient(31 * 1024, revision_id=7), repository, "Category:Test")
                count = collect_category(
                    ExtractSizeClient(33 * 1024, revision_id=8), repository, "Category:Test"
                )
                analyzed = repository.connection.execute(
                    """
                    SELECT sp.external_page_id, sr.external_revision_id
                    FROM catalog_entries ce
                    JOIN source_pages sp ON sp.id = ce.source_page_id
                    JOIN source_revisions sr ON sr.id = ce.source_revision_id
                    ORDER BY sp.external_page_id
                    """
                ).fetchall()
                issue = repository.connection.execute(
                    "SELECT collection_run_id, external_page_id, issue_code FROM collection_issues"
                ).fetchone()
        self.assertEqual(count, 1)
        # Page 10 keeps revision 7 as the analyzed one; page 20 moved to revision 8.
        self.assertEqual([tuple(row) for row in analyzed], [(10, 7), (20, 8)])
        self.assertEqual(tuple(issue), (2, 10, "page_extract_oversize"))
