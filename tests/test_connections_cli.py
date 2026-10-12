"""Unit tests for connections CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.connections_cli import main as cli_main
from kpop_scraping.connections_schema import validate_connections_puzzle
from tests.test_connections_generator import build_connections_test_database


class ConnectionsCliTest(unittest.TestCase):
    """Unit tests for connections CLI."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"

        # Create physical SQLite database on disk
        mem_conn = build_connections_test_database()
        disk_conn = sqlite3.connect(str(self.db_path))
        mem_conn.backup(disk_conn)
        disk_conn.close()
        mem_conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_stdout_output(self):
        """Verify CLI outputs valid JSON to stdout when --output is omitted."""
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(["--database", str(self.db_path), "--seed", "cli-test-seed"])
        self.assertEqual(ret, 0)

        output_str = stdout_buf.getvalue()
        puzzle = json.loads(output_str)
        validate_connections_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-connections-puzzle-v1")

    def test_cli_file_output(self):
        """Verify CLI writes atomic file when --output is provided."""
        out_path = Path(self.temp_dir.name) / "puzzle_out.json"
        ret = cli_main([
            "--database", str(self.db_path),
            "--output", str(out_path),
            "--seed", "cli-test-seed",
        ])
        self.assertEqual(ret, 0)
        self.assertTrue(out_path.is_file())

        with open(out_path, "r", encoding="utf-8") as f:
            puzzle = json.load(f)
        validate_connections_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-connections-puzzle-v1")

    def test_cli_missing_database(self):
        """Verify CLI returns 1 and prints error when database file is missing."""
        missing_db = Path(self.temp_dir.name) / "nonexistent.db"
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            ret = cli_main(["--database", str(missing_db)])
        self.assertEqual(ret, 1)
        self.assertIn("Database does not exist", stderr_buf.getvalue())

    def test_cli_date_option(self):
        """Verify CLI accepts --date and derives reference_date."""
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-17",
            ])
        self.assertEqual(ret, 0)
        puzzle = json.loads(stdout_buf.getvalue())
        self.assertEqual(puzzle["reference_date"], "2026-09-17")

    def test_cli_seed_and_date_options(self):
        """Verify CLI prioritizes --seed over --date derived seed."""
        stdout_buf1 = io.StringIO()
        with patch("sys.stdout", stdout_buf1):
            cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-17",
                "--seed", "custom-seed-123",
            ])
        p1 = json.loads(stdout_buf1.getvalue())

        stdout_buf2 = io.StringIO()
        with patch("sys.stdout", stdout_buf2):
            cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-18",
                "--seed", "custom-seed-123",
            ])
        p2 = json.loads(stdout_buf2.getvalue())

        # Since seed is the same, category selection matches
        self.assertEqual(
            [c["id"] for c in p1["categories"]],
            [c["id"] for c in p2["categories"]],
        )
        self.assertNotEqual(p1["reference_date"], p2["reference_date"])




    @patch("kpop_scraping.connections_cli.sqlite3.connect")
    @patch("kpop_scraping.connections_cli.generate_connections_puzzle")
    def test_cli_database_fallback(self, mock_generate, mock_connect):
        """Verify CLI falls back to non-URI connection if URI connection fails."""
        mock_generate.return_value = {"puzzle_id": "test", "schema_version": "kpop-connections-puzzle-v1"}

        mock_conn = mock_connect.return_value
        # First call fails, second call succeeds
        mock_connect.side_effect = [sqlite3.Error("URI not supported"), mock_conn]

        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(["--database", str(self.db_path), "--seed", "cli-test-seed"])

        self.assertEqual(ret, 0)
        self.assertEqual(mock_connect.call_count, 2)

    @patch("kpop_scraping.connections_cli.generate_connections_puzzle")
    def test_cli_puzzle_generation_failure(self, mock_generate):
        """Verify CLI catches ValueError from puzzle generation and returns 1."""
        mock_generate.side_effect = ValueError("Test puzzle failure")

        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            ret = cli_main(["--database", str(self.db_path), "--seed", "cli-test-seed"])

        self.assertEqual(ret, 1)
        self.assertIn("Connections puzzle generation failed: ValueError: Test puzzle failure", stderr_buf.getvalue())

    @patch("kpop_scraping.connections_cli.write_connections_puzzle_atomic")
    def test_cli_write_output_failure(self, mock_write):
        """Verify CLI catches OSError from file writing and returns 1."""
        mock_write.side_effect = OSError("Test write failure")
        out_path = Path(self.temp_dir.name) / "puzzle_out.json"

        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            ret = cli_main([
                "--database", str(self.db_path),
                "--output", str(out_path),
                "--seed", "cli-test-seed"
            ])

        self.assertEqual(ret, 1)
        self.assertIn("Failed to write connections puzzle output: Test write failure", stderr_buf.getvalue())
if __name__ == "__main__":
    unittest.main()
