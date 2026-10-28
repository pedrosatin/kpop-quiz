"""Unit tests for the daily puzzles CLI."""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import daily_puzzles_cli


def _is_file_except_enriched_manifest(path: Path) -> bool:
    """Everything is a file, as these tests assume, but manifest-v3.json only when it is on disk."""
    return os.path.isfile(path) if path.name == "manifest-v3.json" else True


class TestDailyPuzzlesCLI(unittest.TestCase):
    def test_report_skipped_grid_none(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.report_skipped_grid(None)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")

    def test_report_skipped_grid_published_without_grid(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            daily_puzzles_cli.report_skipped_grid({"published_without_grid": True})

        self.assertIn("WARNING: The published set for this day carries no grid.daily.json", stderr.getvalue())
        self.assertIn("::warning title=Daily grid missing::The published set for this day carries no grid.daily.json", stdout.getvalue())

    def test_report_skipped_grid_generation_failed_no_previous(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.report_skipped_grid({
                "error": "some error",
            })

        self.assertIn("WARNING: Day published without a grid because generation failed: some error (no previous grid available)", stderr.getvalue())

    def test_report_skipped_grid_generation_failed_previous_invalid(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.report_skipped_grid({
                "error": "some error",
                "previous_invalid": "invalid reasons"
            })

        self.assertIn("WARNING: Day published without a grid because generation failed: some error (previous grid rejected: invalid reasons)", stderr.getvalue())

    def test_report_revalidated_grid_regenerated_and_removed(self):
        base = {"reason": "cell (0,0) a x b no longer admits ['Q1']", "previous_grid_id": "old"}
        for extra, expected in (
            ({"action": "regenerated", "grid_id": "new"}, "replaced by grid new"),
            ({"action": "removed", "error": "no 3x3"}, "removed because a new one could not be generated: no 3x3"),
        ):
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr), patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
                daily_puzzles_cli.report_revalidated_grid({**base, **extra})
            self.assertIn("Published grid old no longer meets the eligibility policy", stderr.getvalue())
            self.assertIn(expected, stderr.getvalue())
            self.assertIn("::warning title=Daily grid revalidated::", stdout.getvalue())

    def test_report_revalidated_grid_none(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.report_revalidated_grid(None)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")

    def test_report_reused_grid_none(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            daily_puzzles_cli.report_reused_grid(None)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")

    def test_report_reused_grid_github_actions(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            daily_puzzles_cli.report_reused_grid({
                "reference_date": "2023-01-01",
                "error": "some err"
            })

        self.assertIn("WARNING: Grid kept from 2023-01-01 because generation failed: some err", stderr.getvalue())
        self.assertIn("::warning title=Daily grid not updated::Grid kept from 2023-01-01 because generation failed: some err", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_verify(self, mock_run):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(["--verify", "--output-dir", "dummy_out"])

        self.assertEqual(code, 0)
        self.assertIn("Daily puzzle artifacts verified successfully in dummy_out", stdout.getvalue())
        mock_run.assert_called_once_with(output_dir=Path("dummy_out"), verify_only=True)

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_related_clues_are_off_unless_asked_for(self, mock_run):
        mock_run.return_value = {"reference_date": "2023-01-01", "output_dir": Path("out")}
        for argv, expected in (([], False), (["--related-clues"], True)):
            with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(daily_puzzles_cli.main(argv), 0)
            self.assertIs(mock_run.call_args.kwargs["related_clues"], expected)

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_with_next_output(self, mock_run):
        mock_run.return_value = {
            "reference_date": "2023-01-01",
            "output_dir": Path("out"),
            "next": {
                "reference_date": "2023-01-02",
                "output_dir": Path("out/next"),
                "grid_reused": {"reference_date": "2023-01-01", "error": "err"},
                "grid_skipped": {"error": "skipped err"}
            }
        }

        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(["--ahead"])

        self.assertEqual(code, 0)
        out_str = stdout.getvalue()
        err_str = stderr.getvalue()

        self.assertIn("Daily puzzles for 2023-01-01 generated and verified successfully in out", out_str)
        self.assertIn("Daily puzzles for 2023-01-02 published ahead in out/next", out_str)
        self.assertIn("WARNING: Grid kept from 2023-01-01 because generation failed: err", err_str)
        self.assertIn("WARNING: Day published without a grid because generation failed: skipped err (no previous grid available)", err_str)

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_reports_clue_coverage_of_the_published_day(self, mock_run):
        with tempfile.TemporaryDirectory() as raw:
            out = Path(raw)
            (out / "s.json").write_text(json.dumps({
                "config": {"play_mode": "standard"},
                "questions": [{"clues_available": [{"id": "c"}]}, {"clues_available": []}],
            }))
            (out / "manifest-v2.json").write_text(
                json.dumps({"sessions": {"daily.en.standard": {"path": "s.json"}}})
            )
            mock_run.return_value = {"reference_date": "2023-01-01", "output_dir": out}
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch("pathlib.Path.is_file", _is_file_except_enriched_manifest), redirect_stdout(stdout), redirect_stderr(stderr):
                code = daily_puzzles_cli.main([])
        self.assertEqual(code, 0)
        self.assertIn("[manifest-v2, clients without related clues] standard: 1/2 questions with a clue, 1/1 sessions with at least one", stdout.getvalue())
        self.assertIn("[manifest-v3]: not published, every client reads manifest-v2", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_reports_clue_coverage_for_both_manifests(self, mock_run):
        with tempfile.TemporaryDirectory() as raw:
            out = Path(raw)
            for name, clues in (("legacy", []), ("enriched", [{"id": "c"}])):
                (out / f"{name}.json").write_text(json.dumps({
                    "config": {"play_mode": "standard"},
                    "questions": [{"clues_available": clues}, {"clues_available": []}],
                }))
                (out / f"manifest-v{2 if name == 'legacy' else 3}.json").write_text(
                    json.dumps({"sessions": {"daily.en.standard": {"path": f"{name}.json"}}})
                )
            mock_run.return_value = {"reference_date": "2023-01-01", "output_dir": out}
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch("pathlib.Path.is_file", _is_file_except_enriched_manifest), redirect_stdout(stdout), redirect_stderr(stderr):
                code = daily_puzzles_cli.main([])
        self.assertEqual(code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertIn("[manifest-v2, clients without related clues] standard: 0/2 questions with a clue, 0/1 sessions with at least one", stdout.getvalue())
        self.assertIn("[manifest-v3, current clients] standard: 1/2 questions with a clue, 1/1 sessions with at least one", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_already_published(self, mock_run):
        mock_run.return_value = {
            "reference_date": "2023-01-01",
            "output_dir": Path("out"),
            "already_published": True,
        }
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main([])
        self.assertEqual(code, 0)
        self.assertIn("Daily puzzles for 2023-01-01 already published and verified successfully in out", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_promoted_from_next(self, mock_run):
        mock_run.return_value = {
            "reference_date": "2023-01-01",
            "output_dir": Path("out"),
            "promoted_from_next": True,
        }
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main([])
        self.assertEqual(code, 0)
        self.assertIn("Daily puzzles for 2023-01-01 promoted from next/ and verified successfully in out", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_dry_run(self, mock_run):
        mock_run.return_value = {
            "reference_date": "2023-01-01",
            "output_dir": Path("out"),
            "dry_run": True,
        }
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(["--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn("[dry-run] Daily puzzles for 2023-01-01 generated and verified successfully in out", stdout.getvalue())

    @patch("kpop_scraping.daily_puzzles_cli.run_daily_puzzles")
    def test_main_exception(self, mock_run):
        mock_run.side_effect = Exception("test exception")

        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("pathlib.Path.is_file", return_value=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main([])

        self.assertEqual(code, 1)
        self.assertIn("Daily puzzles generation failed: test exception", stderr.getvalue())

    def test_main_db_not_exist(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(["--database", "some_nonexistent_db.db"])

        self.assertEqual(code, 1)
        self.assertIn("Database does not exist: some_nonexistent_db.db", stderr.getvalue())

    def test_main_dunder_name(self):
        result = subprocess.run([sys.executable, "-m", "kpop_scraping.daily_puzzles_cli", "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("Unified runner for deterministic daily K-pop puzzle generation", result.stdout)
