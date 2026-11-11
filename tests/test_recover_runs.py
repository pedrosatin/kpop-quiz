import sqlite3
import unittest
import tempfile
import io
import json
from pathlib import Path
from contextlib import redirect_stdout
from kpop_scraping.recover_runs import close_interrupted_run, unfinished_runs, main

class RecoverRunsTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        self.connection.execute("CREATE TABLE collection_runs (id INTEGER PRIMARY KEY, started_at TEXT, completed_at TEXT, status TEXT, error TEXT)")
        self.connection.executemany("INSERT INTO collection_runs(id,started_at,status) VALUES (?, '2026-11-10', ?)", [(1, "running"), (2, "running"), (3, "completed")])

    def test_listing_is_read_only_and_skips_tables_not_in_old_databases(self):
        before = self.connection.total_changes
        self.assertEqual([r["id"] for r in unfinished_runs(self.connection)], [1, 2])
        self.assertEqual(self.connection.total_changes, before)

    def test_recovery_changes_only_the_selected_unfinished_run(self):
        close_interrupted_run(self.connection, "collection_runs", 1)
        self.assertEqual([r["id"] for r in unfinished_runs(self.connection)], [2])
        row = self.connection.execute("SELECT status,completed_at,error FROM collection_runs WHERE id=1").fetchone()
        self.assertEqual(row[0], "failed")
        self.assertIsNotNone(row[1])
        self.assertIn("Interrupted", row[2])
        with self.assertRaises(ValueError):
            close_interrupted_run(self.connection, "collection_runs", 3)
        with self.assertRaises(ValueError):
            close_interrupted_run(self.connection, "collection_runs; DROP TABLE collection_runs", 2)

    def test_cli_lists_then_closes_only_the_requested_record(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "runs.db"
            destination = sqlite3.connect(database)
            self.addCleanup(destination.close)
            self.connection.commit()
            self.connection.backup(destination)
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(main(["--database", str(database)]), 0)
            self.assertEqual(len(json.loads(stdout.getvalue())), 2)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--database", str(database), "--fail-run", "collection_runs:1"]), 0)
            self.assertEqual([row["id"] for row in unfinished_runs(destination)], [2])
