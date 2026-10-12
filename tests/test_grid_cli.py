"""Unit tests for intersection grid CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.grid_cli import main as cli_main
from kpop_scraping.grid_schema import validate_intersection_grid
from tests.test_grid_generator import build_grid_test_database


class IntersectionGridCLITest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmpdir.name)
        self.db_path = self.tmp_path / "test.db"

        # Backup memory database to disk file for CLI tests
        mem_conn = build_grid_test_database()
        file_conn = sqlite3.connect(str(self.db_path))
        mem_conn.backup(file_conn)
        file_conn.close()
        mem_conn.close()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_cli_missing_database_returns_error(self) -> None:
        missing_db = self.tmp_path / "nonexistent.db"
        exit_code = cli_main(["--database", str(missing_db)])
        self.assertEqual(exit_code, 1)

    def test_cli_generates_atomic_output_with_seed(self) -> None:
        output_file = self.tmp_path / "grid_output.json"
        exit_code = cli_main([
            "--database", str(self.db_path),
            "--output", str(output_file),
            "--seed", "test-cli-seed-01",
        ])
        self.assertEqual(exit_code, 0)
        self.assertTrue(output_file.exists())

        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        validate_intersection_grid(data)
        self.assertEqual(data["dimensions"], {"rows": 3, "cols": 3})

    def test_cli_generates_daily_puzzle_with_date(self) -> None:
        output_file = self.tmp_path / "daily_grid.json"
        exit_code = cli_main([
            "--database", str(self.db_path),
            "--output", str(output_file),
            "--date", "2026-09-17",
        ])
        self.assertEqual(exit_code, 0)
        self.assertTrue(output_file.exists())

        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["reference_date"], "2026-09-17")
        validate_intersection_grid(data)

    def test_cli_outputs_to_stdout_when_output_omitted(self) -> None:
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            exit_code = cli_main([
                "--database", str(self.db_path),
                "--seed", "stdout-seed",
            ])
        self.assertEqual(exit_code, 0)
        output_text = stdout_capture.getvalue()
        self.assertTrue(len(output_text) > 0)
        data = json.loads(output_text)
        validate_intersection_grid(data)


    @patch("kpop_scraping.grid_cli.sqlite3.connect")
    def test_cli_sqlite_fallback_connection(self, mock_connect) -> None:
        # First call fails (URI unsupported), second succeeds (fallback)
        fallback_conn = sqlite3.connect(":memory:")
        fallback_conn.row_factory = sqlite3.Row
        mock_connect.side_effect = [sqlite3.Error("URI not supported"), fallback_conn]
        with patch("sys.stderr", io.StringIO()) as stderr_capture:
            with patch("kpop_scraping.grid_cli.generate_intersection_grid") as mock_gen:
                mock_gen.return_value = {"grid_id": "fallback", "dimensions": {"rows": 3, "cols": 3}}
                stdout_capture = io.StringIO()
                with patch("sys.stdout", stdout_capture):
                    exit_code = cli_main([
                        "--database", str(self.db_path),
                        "--seed", "fallback-seed",
                    ])
                    self.assertEqual(exit_code, 0)


    @patch("kpop_scraping.grid_cli.generate_intersection_grid")
    def test_cli_generate_grid_failure(self, mock_generate) -> None:
        mock_generate.side_effect = ValueError("Generation failed")
        with patch("sys.stderr", io.StringIO()) as stderr_capture:
            exit_code = cli_main([
                "--database", str(self.db_path),
                "--seed", "fail-seed",
            ])
            self.assertEqual(exit_code, 1)
            self.assertIn("Grid generation failed: ValueError: Generation failed", stderr_capture.getvalue())

    @patch("kpop_scraping.grid_cli.write_intersection_grid_atomic")
    def test_cli_write_output_failure(self, mock_write) -> None:
        mock_write.side_effect = OSError("Permission denied")
        output_file = self.tmp_path / "fail_output.json"
        with patch("sys.stderr", io.StringIO()) as stderr_capture:
            exit_code = cli_main([
                "--database", str(self.db_path),
                "--output", str(output_file),
                "--seed", "fail-write-seed",
            ])
            self.assertEqual(exit_code, 1)
            self.assertIn("Failed to write intersection grid output: Permission denied", stderr_capture.getvalue())


if __name__ == "__main__":
    unittest.main()
