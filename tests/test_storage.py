import gzip
import hashlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import Page
from kpop_scraping.storage import (
    Repository,
    SnapshotStore,
    SnapshotIntegrityError,
    apply_migrations,
    canonical_json,
)


class SnapshotClient:
    provider = "wikipedia"
    language = "en"

    def iter_category_members(self, _category):
        yield {"pageid": 10, "title": "Alpha"}

    def get_pages(self, page_ids):
        return [
            Page(
                page_id=page_id,
                title="Alpha",
                canonical_url="https://en.wikipedia.org/wiki/Alpha",
                extract="Résumé",
                revision_id=77,
                source_payload={
                    "title": "Alpha",
                    "pageid": page_id,
                    "extract": "Résumé",
                    "canonicalurl": "https://en.wikipedia.org/wiki/Alpha",
                    "revisions": [{"revid": 77}],
                },
            )
            for page_id in page_ids
        ]


class StorageTest(unittest.TestCase):
    def test_snapshot_write_syncs_file_then_directory_after_replace(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = SnapshotStore(root / "raw")
            events = []
            real_replace = os.replace

            def record_fsync(file_descriptor):
                events.append(("fsync_file", file_descriptor))

            def record_replace(source, target):
                events.append(("replace", Path(source), Path(target)))
                real_replace(source, target)

            def record_directory_sync(path):
                events.append(("sync_directory", path))

            with (
                patch("kpop_scraping.storage.os.fsync", side_effect=record_fsync),
                patch("kpop_scraping.storage.os.replace", side_effect=record_replace),
                patch.object(
                    store, "_sync_directory", side_effect=record_directory_sync
                ),
            ):
                relative_path, _digest = store.write(
                    "wikipedia", "en", 10, 77, b'{"pageid":10}'
                )

            target = root / "raw" / relative_path
            self.assertEqual(
                [event[0] for event in events],
                ["fsync_file", "replace", "sync_directory"],
            )
            self.assertEqual(events[1][2], target)
            self.assertEqual(events[2][1], target.parent)
            self.assertTrue(target.is_file())

    def test_snapshot_write_propagates_directory_sync_failure_without_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            raw_dir = Path(directory) / "raw"
            store = SnapshotStore(raw_dir)

            with patch.object(
                store, "_sync_directory", side_effect=OSError("I/O error")
            ):
                with self.assertRaisesRegex(OSError, "I/O error"):
                    store.write("wikipedia", "en", 10, 77, b'{"pageid":10}')

            target = raw_dir / "wikipedia" / "en" / "10" / "77.json.gz"
            self.assertTrue(target.is_file())
            self.assertEqual(
                list(target.parent.glob(f".{target.name}.*")),
                [],
            )

    @unittest.skipUnless(os.name == "posix", "directory fsync is POSIX-specific")
    def test_directory_sync_opens_fsyncs_and_closes_directory(self):
        directory = Path("/tmp/snapshot-directory")
        directory_fd = 91
        with (
            patch("kpop_scraping.storage.os.open", return_value=directory_fd) as open_mock,
            patch("kpop_scraping.storage.os.fsync") as fsync_mock,
            patch("kpop_scraping.storage.os.close") as close_mock,
        ):
            SnapshotStore._sync_directory(directory)

        expected_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        open_mock.assert_called_once_with(directory, expected_flags)
        fsync_mock.assert_called_once_with(directory_fd)
        close_mock.assert_called_once_with(directory_fd)

    @unittest.skipUnless(os.name == "posix", "directory fsync is POSIX-specific")
    def test_directory_sync_closes_descriptor_when_fsync_fails(self):
        directory_fd = 92
        with (
            patch("kpop_scraping.storage.os.open", return_value=directory_fd),
            patch(
                "kpop_scraping.storage.os.fsync", side_effect=OSError("I/O error")
            ),
            patch("kpop_scraping.storage.os.close") as close_mock,
        ):
            with self.assertRaisesRegex(OSError, "I/O error"):
                SnapshotStore._sync_directory(Path("/tmp/snapshot-directory"))

        close_mock.assert_called_once_with(directory_fd)

    def test_failed_migration_rolls_back_all_its_statements(self):
        connection = sqlite3.connect(":memory:")
        migrations = (
            (
                1,
                "broken",
                (
                    "CREATE TABLE should_be_rolled_back(id INTEGER)",
                    "INSERT INTO table_that_does_not_exist VALUES (1)",
                ),
            ),
        )
        with self.assertRaises(sqlite3.OperationalError):
            apply_migrations(connection, migrations)
        table = connection.execute(
            "SELECT name FROM sqlite_master WHERE name='should_be_rolled_back'"
        ).fetchone()
        version = connection.execute(
            "SELECT version FROM schema_migrations"
        ).fetchone()
        connection.close()
        self.assertIsNone(table)
        self.assertIsNone(version)

    def test_repeated_revision_reuses_snapshot_and_links_both_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "evidence"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                collect_category(SnapshotClient(), repository, "Category:Test")
                revision = repository.connection.execute(
                    "SELECT snapshot_path, content_sha256 FROM source_revisions"
                ).fetchone()
                run_links = repository.connection.execute(
                    "SELECT COUNT(*) FROM collection_run_revisions"
                ).fetchone()[0]
                runs = repository.connection.execute(
                    "SELECT status FROM collection_runs ORDER BY id"
                ).fetchall()

            snapshots = list(raw_dir.rglob("*.json.gz"))
            self.assertEqual(len(snapshots), 1)
            self.assertEqual(revision["snapshot_path"], "wikipedia/en/10/77.json.gz")
            content = gzip.decompress(snapshots[0].read_bytes())
            self.assertEqual(hashlib.sha256(content).hexdigest(), revision["content_sha256"])
            self.assertEqual(content, canonical_json(SnapshotClient().get_pages([10])[0].source_payload))
            self.assertEqual(run_links, 2)
            self.assertEqual([row["status"] for row in runs], ["completed", "completed"])

    def test_changed_content_for_same_revision_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db", raw_dir=root / "raw") as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                changed = SnapshotClient()
                original_get_pages = changed.get_pages

                def get_changed_pages(page_ids):
                    pages = original_get_pages(page_ids)
                    page = pages[0]
                    return [
                        Page(
                            page.page_id,
                            page.title,
                            page.canonical_url,
                            "Changed",
                            page.revision_id,
                            {**page.source_payload, "extract": "Changed"},
                        )
                    ]

                changed.get_pages = get_changed_pages
                with self.assertRaises(SnapshotIntegrityError):
                    collect_category(changed, repository, "Category:Test")
                failed = repository.connection.execute(
                    "SELECT status FROM collection_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()["status"]
                revisions = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0]
            self.assertEqual(failed, "failed")
            self.assertEqual(revisions, 1)

    def test_corrupted_existing_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                snapshot = next(raw_dir.rglob("*.json.gz"))
                snapshot.write_bytes(gzip.compress(b'{"corrupted":true}', mtime=0))

                with self.assertRaisesRegex(
                    SnapshotIntegrityError, "snapshot hash mismatch"
                ):
                    collect_category(SnapshotClient(), repository, "Category:Test")

                runs = repository.connection.execute(
                    "SELECT status FROM collection_runs ORDER BY id"
                ).fetchall()
                revision_count = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0]

            self.assertEqual([row["status"] for row in runs], ["completed", "failed"])
            self.assertEqual(revision_count, 1)

    def test_existing_database_is_migrated_without_losing_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "legacy.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE collection_runs (
                    id INTEGER PRIMARY KEY, category TEXT NOT NULL, started_at TEXT NOT NULL,
                    completed_at TEXT, status TEXT NOT NULL, pages_collected INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );
                CREATE TABLE source_pages (
                    page_id INTEGER PRIMARY KEY, title TEXT NOT NULL, canonical_url TEXT NOT NULL,
                    extract TEXT NOT NULL, revision_id INTEGER, fetched_at TEXT NOT NULL,
                    last_run_id INTEGER NOT NULL REFERENCES collection_runs(id)
                );
                CREATE INDEX source_pages_title_idx ON source_pages(title);
                INSERT INTO collection_runs VALUES (1, 'Category:Test', '2026-09-12T00:00:00+00:00',
                    '2026-09-12T00:00:01+00:00', 'completed', 1, NULL);
                INSERT INTO source_pages VALUES (10, 'Alpha', 'https://example.test/Alpha',
                    'Text', 7, '2026-09-12T00:00:01+00:00', 1);
                """
            )
            connection.close()

            with Repository(database) as repository:
                versions = repository.connection.execute(
                    "SELECT version FROM schema_migrations ORDER BY version"
                ).fetchall()
                page = repository.connection.execute(
                    "SELECT provider, language, external_page_id, title FROM source_pages"
                ).fetchone()

            self.assertEqual([row["version"] for row in versions], [1, 2, 3, 4, 5])
            self.assertEqual(tuple(page), ("wikipedia", "en", 10, "Alpha"))


if __name__ == "__main__":
    unittest.main()
