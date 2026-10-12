import argparse
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch, MagicMock

from kpop_scraping.cli import build_parser, main
from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.storage import SnapshotIntegrityError


class CLITest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.database = self.root / "kpop.db"

        # Touch database file to exist
        self.database.touch()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_build_parser(self):
        parser = build_parser()
        self.assertIsInstance(parser, argparse.ArgumentParser)

    @patch("kpop_scraping.cli.Repository")
    @patch("kpop_scraping.cli.collect_category")
    @patch("kpop_scraping.cli.classify_catalog")
    def test_main_default_behavior(self, mock_classify, mock_collect, mock_repo):
        # Setup mocks
        mock_repo_instance = MagicMock()
        mock_repo.return_value.__enter__.return_value = mock_repo_instance
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (0,)
        mock_repo_instance.connection.execute.return_value = mock_cursor

        mock_collect.return_value = 5
        mock_stats = MagicMock()
        mock_stats.accepted = 2
        mock_stats.rejected = 1
        mock_stats.pending = 2
        mock_classify.return_value = mock_stats
        mock_repo_instance.export_catalog_csv.return_value = 3

        # Capture output
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["--database", str(self.database)])

        # Assertions
        self.assertEqual(exit_code, 0)
        mock_repo.assert_called_once()
        mock_collect.assert_called_once()
        mock_classify.assert_called_once()

        output = stdout.getvalue()
        self.assertIn("Collected 5 pages", output)
        self.assertIn("Catalog: 2 accepted, 1 rejected, 2 pending", output)

    def test_limit_validation(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", str(self.database), "--limit", "0"])
        self.assertIn("--limit must be greater than zero", str(cm.exception))

    def test_user_agent_validation(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", str(self.database), "--user-agent", "  "])
        self.assertIn("--user-agent must not be empty", str(cm.exception))

    def test_facts_limit_validation(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", str(self.database), "--facts", "--facts-limit", "0"])
        self.assertIn("--facts-limit must be greater than zero", str(cm.exception))

    def test_release_group_limit_validation(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", str(self.database), "--releases", "--release-group-limit", "0"])
        self.assertTrue("must be between 1 and" in str(cm.exception))

    def test_release_group_offset_validation(self):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", str(self.database), "--releases", "--release-group-offset", "-1"])
        self.assertIn("--release-group-offset must not be negative", str(cm.exception))

    @patch("kpop_scraping.cli.Repository")
    @patch("kpop_scraping.cli.collect_category")
    @patch("kpop_scraping.cli.classify_catalog")
    @patch("kpop_scraping.cli.extract_facts")
    @patch("kpop_scraping.cli.export_fact_coverage_csv")
    def test_facts_execution(self, mock_export_facts, mock_extract_facts, mock_classify, mock_collect, mock_repo):
        # Setup mocks
        mock_repo_instance = MagicMock()
        mock_repo.return_value.__enter__.return_value = mock_repo_instance
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (0,)
        mock_repo_instance.connection.execute.return_value = mock_cursor

        mock_collect.return_value = 5

        mock_stats = MagicMock()
        mock_stats.accepted = 2
        mock_stats.rejected = 1
        mock_stats.pending = 2
        mock_classify.return_value = mock_stats

        mock_fact_totals = MagicMock()
        mock_fact_totals.groups = 2
        mock_fact_totals.entities = 5
        mock_fact_totals.batches = 1
        mock_fact_totals.accepted = 10
        mock_fact_totals.rejected = 1
        mock_fact_totals.conflict = 0
        mock_fact_totals.superseded = 0
        mock_fact_totals.stale = 0
        mock_extract_facts.return_value = mock_fact_totals

        mock_export_facts.return_value = 10
        mock_repo_instance.export_catalog_csv.return_value = 3

        # Capture output
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["--database", str(self.database), "--facts"])

        # Assertions
        self.assertEqual(exit_code, 0)
        mock_extract_facts.assert_called_once()
        mock_export_facts.assert_called_once()

        output = stdout.getvalue()
        self.assertIn("Facts: 2 groups, 5 entities", output)

    @patch("kpop_scraping.cli.Repository")
    def test_exception_handling(self, mock_repo):
        # Setup mock to raise exception
        mock_repo.side_effect = RuntimeError("Test error")

        # Capture output
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["--database", str(self.database)])

        # Assertions
        self.assertEqual(exit_code, 1)
        output = stdout.getvalue()
        self.assertIn("Pipeline failed: RuntimeError: Test error", output)


    @patch("kpop_scraping.cli.Repository")
    @patch("kpop_scraping.cli.collect_category")
    @patch("kpop_scraping.cli.classify_catalog")
    @patch("kpop_scraping.cli.discover_releases")
    @patch("kpop_scraping.cli.collect_release_facts")
    @patch("kpop_scraping.cli.export_release_coverage_csv")
    def test_releases_execution(
        self, mock_export_releases, mock_collect_releases, mock_discover,
        mock_classify, mock_collect, mock_repo
    ):
        # Setup mocks
        mock_repo_instance = MagicMock()
        mock_repo.return_value.__enter__.return_value = mock_repo_instance
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (0,)
        mock_repo_instance.connection.execute.return_value = mock_cursor

        mock_collect.return_value = 5

        mock_stats = MagicMock()
        mock_stats.accepted = 2
        mock_stats.rejected = 1
        mock_stats.pending = 2
        mock_classify.return_value = mock_stats

        mock_discover.return_value = MagicMock()

        mock_release_totals = MagicMock()
        mock_release_totals.groups = 3
        mock_release_totals.entities = 10
        mock_release_totals.accepted = 8
        mock_release_totals.rejected = 2
        mock_release_totals.conflict = 0
        mock_collect_releases.return_value = mock_release_totals

        mock_export_releases.return_value = 15
        mock_repo_instance.export_catalog_csv.return_value = 3

        # Capture output
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = main(["--database", str(self.database), "--releases"])

        # Assertions
        self.assertEqual(exit_code, 0)
        mock_discover.assert_called_once()
        mock_collect_releases.assert_called_once()
        mock_export_releases.assert_called_once()

        output = stdout.getvalue()
        self.assertIn("Releases: 3 discovery groups, 10 release entities saved", output)


if __name__ == "__main__":
    unittest.main()
