"""Unit tests for name guess puzzle CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.name_guess_cli import main as cli_main
from kpop_scraping.name_guess_schema import validate_name_guess_puzzle
from tests.test_name_guess_generator import build_name_guess_test_database


class TestNameGuessCLI(unittest.TestCase):
    """Test command line interface for name guess puzzle generator."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "test.db"

        disk_conn = sqlite3.connect(str(self.db_path))
        disk_conn.row_factory = sqlite3.Row
        mem_conn = build_name_guess_test_database()
        mem_conn.backup(disk_conn)
        disk_conn.close()
        mem_conn.close()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_cli_stdout_success(self):
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf), patch("sys.stderr", stderr_buf):
            exit_code = cli_main(
                [
                    "--database",
                    str(self.db_path),
                    "--seed",
                    "cli-test",
                    "--date",
                    "2026-09-18",
                ]
            )
        self.assertEqual(exit_code, 0)
        output = json.loads(stdout_buf.getvalue())
        self.assertEqual(output["schema_version"], "kpop-name-guess-puzzle-v1")
        self.assertEqual(output["reference_date"], "2026-09-18")

    def test_cli_output_file_success(self):
        output_file = Path(self.tmpdir.name) / "name-guess.daily.json"
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf), patch("sys.stderr", stderr_buf):
            exit_code = cli_main(
                [
                    "--database",
                    str(self.db_path),
                    "--output",
                    str(output_file),
                    "--seed",
                    "cli-file-test",
                    "--word-length",
                    "5",
                ]
            )
        self.assertEqual(exit_code, 0)
        self.assertTrue(output_file.is_file())
        self.assertIn("Name guess puzzle written to", stdout_buf.getvalue())

        loaded = json.loads(output_file.read_text(encoding="utf-8"))
        validate_name_guess_puzzle(loaded)
        self.assertEqual(loaded["word_length"], 5)

    def test_cli_missing_database_fails(self):
        nonexistent = Path(self.tmpdir.name) / "nonexistent.db"
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            exit_code = cli_main(["--database", str(nonexistent)])
        self.assertEqual(exit_code, 1)
        self.assertIn("Database does not exist", stderr_buf.getvalue())



    def test_cli_generator_error(self):
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            with patch("kpop_scraping.name_guess_cli.generate_name_guess_puzzle", side_effect=ValueError("Test generator error")):
                exit_code = cli_main(
                    [
                        "--database",
                        str(self.db_path),
                        "--seed",
                        "cli-test",
                        "--date",
                        "2026-09-18",
                    ]
                )
        self.assertEqual(exit_code, 1)
        self.assertIn("Name guess puzzle generation failed: ValueError: Test generator error", stderr_buf.getvalue())


    def test_cli_write_error(self):
        output_file = Path(self.tmpdir.name) / "name-guess.daily.json"
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            with patch("kpop_scraping.name_guess_cli.write_name_guess_puzzle_atomic", side_effect=OSError("Test write error")):
                exit_code = cli_main(
                    [
                        "--database",
                        str(self.db_path),
                        "--output",
                        str(output_file),
                        "--seed",
                        "cli-file-test",
                        "--word-length",
                        "5",
                    ]
                )
        self.assertEqual(exit_code, 1)
        self.assertIn("Failed to write output file: Test write error", stderr_buf.getvalue())

if __name__ == "__main__":
    unittest.main()
