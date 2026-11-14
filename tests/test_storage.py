import gzip
import hashlib
import io
import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.collector import collect_category
from kpop_scraping.mediawiki import Page
from kpop_scraping.storage import (
    ExtractDrift,
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


class DriftClient(SnapshotClient):
    """Returns revision 77 of page 10 with a new extract, and page 11."""

    def iter_category_members(self, _category):
        yield {"pageid": 10, "title": "Alpha"}
        yield {"pageid": 11, "title": "Beta"}

    def get_pages(self, page_ids):
        pages = []
        for page_id in page_ids:
            if page_id == 10:
                page = super().get_pages([10])[0]
                pages.append(replace(
                    page,
                    extract="Rewritten by a template",
                    source_payload={
                        **page.source_payload,
                        "extract": "Rewritten by a template",
                        "touched": "later",
                    },
                ))
            else:
                pages.append(Page(
                    page_id=page_id,
                    title="Beta",
                    canonical_url="https://en.wikipedia.org/wiki/Beta",
                    extract="Beta is a group.",
                    revision_id=88,
                ))
        return pages


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

    def test_snapshot_write_removes_temp_file_when_file_sync_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            target_dir = Path(directory) / "raw" / "wikipedia" / "en" / "10"
            store = SnapshotStore(Path(directory) / "raw")

            with patch(
                "kpop_scraping.storage.os.fsync", side_effect=OSError("I/O error")
            ):
                with self.assertRaisesRegex(OSError, "I/O error"):
                    store.write("wikipedia", "en", 10, 77, b'{"pageid":10}')

            self.assertEqual(list(target_dir.iterdir()), [])

    def test_directory_sync_failure_prevents_snapshot_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "quiz.db"
            repository = Repository(database_path)
            run_id = repository.start_run("Category:K-pop")
            page = SnapshotClient().get_pages([10])[0]

            with patch.object(
                repository.snapshots,
                "_sync_directory",
                side_effect=OSError("I/O error"),
            ):
                with self.assertRaisesRegex(OSError, "I/O error"):
                    repository.save_pages(run_id, [page])

            self.assertEqual(
                repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0],
                0,
            )
            repository.connection.close()

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

    def test_extract_drift_keeps_the_snapshot_and_the_run_completes_two_days_in_a_row(self):
        # Day 0 stores revision 77 of page 10. On days 1 and 2 the API returns
        # the same revision with another extract, as after an edit to a
        # transcluded template, and page 11 appears with its first revision.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                snapshot = raw_dir / "wikipedia" / "en" / "10" / "77.json.gz"
                original = snapshot.read_bytes()
                stored_row = tuple(repository.connection.execute(
                    "SELECT id, snapshot_path, content_sha256 FROM source_revisions"
                ).fetchone())
                catalog = tuple(repository.connection.execute(
                    "SELECT * FROM catalog_entries"
                ).fetchone())
                page_row = tuple(repository.connection.execute(
                    "SELECT extract, last_run_id FROM source_pages WHERE external_page_id=10"
                ).fetchone())

                collected = [
                    collect_category(DriftClient(), repository, "Category:Test")
                    for _day in (1, 2)
                ]

                runs = [tuple(row) for row in repository.connection.execute(
                    "SELECT id, status, pages_collected FROM collection_runs ORDER BY id"
                )]
                issues = [tuple(row) for row in repository.connection.execute(
                    """SELECT collection_run_id, external_page_id, issue_code, detail
                    FROM collection_issues ORDER BY id"""
                )]
                revisions = [tuple(row) for row in repository.connection.execute(
                    """SELECT sp.external_page_id, sr.external_revision_id
                    FROM source_revisions sr JOIN source_pages sp ON sp.id=sr.source_page_id
                    ORDER BY sr.id"""
                )]
                self.assertEqual(
                    tuple(repository.connection.execute(
                        "SELECT id, snapshot_path, content_sha256 FROM source_revisions "
                        "WHERE id=?", (stored_row[0],)
                    ).fetchone()),
                    stored_row,
                )
                self.assertEqual(
                    tuple(repository.connection.execute(
                        "SELECT * FROM catalog_entries WHERE source_page_id=?", (catalog[0],)
                    ).fetchone()),
                    catalog,
                )
                self.assertEqual(
                    tuple(repository.connection.execute(
                        "SELECT extract, last_run_id FROM source_pages WHERE external_page_id=10"
                    ).fetchone()),
                    page_row,
                )
                drifts = list(repository.extract_drifts)

            self.assertEqual(collected, [1, 1])
            self.assertEqual(
                runs, [(1, "completed", 1), (2, "completed", 1), (3, "completed", 1)]
            )
            self.assertEqual(snapshot.read_bytes(), original)
            self.assertEqual(revisions, [(10, 77), (11, 88)])
            stored_hash = hashlib.sha256("Résumé".encode()).hexdigest()
            fetched_hash = hashlib.sha256("Rewritten by a template".encode()).hexdigest()
            detail = (
                "Extract of revision 77 (en) differs from the stored snapshot, which "
                f"was kept; extract SHA-256 {stored_hash} stored, {fetched_hash} fetched"
            )
            # One issue per run: the second day records its own and adds no other.
            self.assertEqual(
                issues,
                [(2, 10, "extract_drift", detail), (3, 10, "extract_drift", detail)],
            )
            self.assertEqual(
                drifts,
                [ExtractDrift("wikipedia", "en", 10, 77, stored_hash, fetched_hash)],
            )

    def test_extract_drift_over_a_damaged_snapshot_still_fails(self):
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
                    collect_category(DriftClient(), repository, "Category:Test")
                status = repository.connection.execute(
                    "SELECT status FROM collection_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()[0]
                issues = repository.connection.execute(
                    "SELECT COUNT(*) FROM collection_issues"
                ).fetchone()[0]
            self.assertEqual(status, "failed")
            self.assertEqual(issues, 0)
            self.assertEqual(repository.extract_drifts, [])

    def test_stored_snapshot_of_another_revision_fails_as_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                # A file whose hash matches the database but holds revision 78.
                content = canonical_json({
                    "pageid": 10, "title": "Alpha", "extract": "Résumé",
                    "revisions": [{"revid": 78}],
                })
                snapshot = next(raw_dir.rglob("*.json.gz"))
                snapshot.write_bytes(gzip.compress(content, mtime=0))
                repository.connection.execute(
                    "UPDATE source_revisions SET content_sha256=?",
                    (hashlib.sha256(content).hexdigest(),),
                )
                repository.connection.commit()

                with self.assertRaisesRegex(
                    SnapshotIntegrityError, "revision 77 of page 10 has an invalid snapshot"
                ):
                    collect_category(DriftClient(), repository, "Category:Test")

    def test_fetched_payload_of_another_revision_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with Repository(root / "test.db", raw_dir=root / "raw") as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                changed = SnapshotClient()
                original_get_pages = changed.get_pages

                def get_changed_pages(page_ids):
                    page = original_get_pages(page_ids)[0]
                    return [replace(page, source_payload={
                        **page.source_payload, "extract": "Changed", "revisions": [{"revid": 78}],
                    })]

                changed.get_pages = get_changed_pages
                with self.assertRaisesRegex(
                    SnapshotIntegrityError, "revision 77 of page 10 changed content"
                ):
                    collect_category(changed, repository, "Category:Test")
                failed = repository.connection.execute(
                    "SELECT status FROM collection_runs ORDER BY id DESC LIMIT 1"
                ).fetchone()["status"]
                revisions = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0]
            self.assertEqual(failed, "failed")
            self.assertEqual(revisions, 1)

    def test_fetched_payload_of_another_page_or_without_extract_is_rejected(self):
        cases = {
            "another page": lambda payload: {**payload, "pageid": 99},
            "no extract": lambda payload: {
                key: value for key, value in payload.items() if key != "extract"
            },
        }
        for name, change in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with Repository(root / "test.db", raw_dir=root / "raw") as repository:
                    collect_category(SnapshotClient(), repository, "Category:Test")
                    changed = SnapshotClient()
                    original_get_pages = changed.get_pages

                    def get_changed_pages(page_ids, original_get_pages=original_get_pages, change=change):
                        page = original_get_pages(page_ids)[0]
                        return [replace(page, source_payload=change(page.source_payload))]

                    changed.get_pages = get_changed_pages
                    with self.assertRaisesRegex(
                        SnapshotIntegrityError, "revision 77 of page 10 changed content"
                    ):
                        collect_category(changed, repository, "Category:Test")
                    self.assertEqual(repository.extract_drifts, [])

    def test_stored_snapshot_that_is_not_json_fails_as_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                # A file whose hash matches the database but is not JSON.
                content = b"not json"
                snapshot = next(raw_dir.rglob("*.json.gz"))
                snapshot.write_bytes(gzip.compress(content, mtime=0))
                repository.connection.execute(
                    "UPDATE source_revisions SET content_sha256=?",
                    (hashlib.sha256(content).hexdigest(),),
                )
                repository.connection.commit()

                with self.assertRaisesRegex(
                    SnapshotIntegrityError, "revision 77 of page 10 has an invalid snapshot"
                ):
                    collect_category(DriftClient(), repository, "Category:Test")
                self.assertEqual(repository.extract_drifts, [])

    def test_repeated_revision_ignores_mutable_mediawiki_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                snapshot = next(raw_dir.rglob("*.json.gz"))
                original = snapshot.read_bytes()
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
                            page.extract,
                            page.revision_id,
                            {
                                **page.source_payload,
                                "extract": f"{page.extract}\n\n",
                                "touched": "later",
                            },
                        )
                    ]

                changed.get_pages = get_changed_pages
                collect_category(changed, repository, "Category:Test")
                revisions = repository.connection.execute(
                    "SELECT COUNT(*) FROM source_revisions"
                ).fetchone()[0]

            self.assertEqual(revisions, 1)
            self.assertEqual(snapshot.read_bytes(), original)

    def test_orphan_snapshot_from_failed_run_is_quarantined_and_replaced(self):
        # Mirrors the daily job: copy the database before the rebuild, let a
        # run write and reference a snapshot, then restore the copy. The
        # restored database does not reference the snapshot, and the file on
        # disk holds the same revision with an older ``touched``. Collecting
        # again must move that file to the quarantine and write the new one.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            database = root / "kpop.db"
            cached = root / "kpop.db.cached"
            with Repository(database, raw_dir=raw_dir):
                pass
            shutil.copyfile(database, cached)

            with Repository(database, raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
            shutil.copyfile(cached, database)

            snapshot = next(raw_dir.rglob("*.json.gz"))
            payload = json.loads(gzip.decompress(snapshot.read_bytes()))
            payload["touched"] = "earlier"
            orphan_bytes = gzip.compress(canonical_json(payload), mtime=0)
            snapshot.write_bytes(orphan_bytes)
            orphan_digest = hashlib.sha256(orphan_bytes).hexdigest()

            stderr = io.StringIO()
            with (
                Repository(database, raw_dir=raw_dir) as repository,
                redirect_stderr(stderr),
            ):
                collect_category(SnapshotClient(), repository, "Category:Test")
                rows = repository.connection.execute(
                    "SELECT snapshot_path, content_sha256 FROM source_revisions"
                ).fetchall()
                self.assertEqual(len(rows), 1)
                repository.snapshots.verify(
                    rows[0]["snapshot_path"], rows[0]["content_sha256"]
                )

            quarantine = (
                raw_dir
                / ".orphans"
                / "wikipedia"
                / "en"
                / "10"
                / f"77.json.gz.{orphan_digest}.orphan"
            )
            self.assertEqual(quarantine.read_bytes(), orphan_bytes)
            self.assertEqual(list(raw_dir.rglob("*.json.gz")), [snapshot])
            self.assertIn("wikipedia/en/10/77.json.gz", stderr.getvalue())
            self.assertIn(str(quarantine), stderr.getvalue())

    def test_damaged_gzip_body_fails_integrity_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            with Repository(root / "test.db", raw_dir=raw_dir) as repository:
                collect_category(SnapshotClient(), repository, "Category:Test")
                row = repository.connection.execute(
                    "SELECT snapshot_path, content_sha256 FROM source_revisions"
                ).fetchone()
                snapshot = raw_dir / row["snapshot_path"]
                original = snapshot.read_bytes()
                # A valid gzip header followed by bytes that are not deflate
                # data makes zlib raise its own error instead of OSError.
                snapshot.write_bytes(original[:10] + b"\xff" * 16)

                with self.assertRaisesRegex(
                    SnapshotIntegrityError, "cannot read snapshot"
                ):
                    repository.snapshots.verify(
                        row["snapshot_path"], row["content_sha256"]
                    )

    def test_damaged_gzip_orphan_is_quarantined_and_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            raw_dir = Path(directory) / "raw"
            store = SnapshotStore(raw_dir)
            content = b'{"pageid":10}'
            target = raw_dir / "wikipedia" / "en" / "10" / "77.json.gz"
            target.parent.mkdir(parents=True)
            damaged = gzip.compress(content, mtime=0)[:10] + b"\xff" * 16
            target.write_bytes(damaged)

            with redirect_stderr(io.StringIO()):
                relative_path, digest = store.write(
                    "wikipedia", "en", 10, 77, content
                )

            self.assertEqual(store.read(relative_path, digest), content)
            quarantine = (
                raw_dir
                / ".orphans"
                / "wikipedia"
                / "en"
                / "10"
                / f"77.json.gz.{hashlib.sha256(damaged).hexdigest()}.orphan"
            )
            self.assertEqual(quarantine.read_bytes(), damaged)

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

            self.assertEqual([row["version"] for row in versions], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            self.assertEqual(tuple(page), ("wikipedia", "en", 10, "Alpha"))


if __name__ == "__main__":
    unittest.main()
