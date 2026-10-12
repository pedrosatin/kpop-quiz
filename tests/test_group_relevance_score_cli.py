import sqlite3
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from io import StringIO

from kpop_scraping.group_relevance_score_cli import main
from kpop_scraping.group_relevance_scoring import RelevanceScoreError


class TestGroupRelevanceScoreCli(unittest.TestCase):
    @patch("kpop_scraping.group_relevance_score_cli.Repository")
    @patch("kpop_scraping.group_relevance_score_cli.store_relevance_scores")
    def test_main_success(self, mock_store, mock_repository):
        mock_repo_instance = MagicMock()
        mock_repository.return_value.__enter__.return_value = mock_repo_instance
        mock_store.return_value = 42

        with patch("sys.stdout", new=StringIO()) as fake_out:
            result = main(["--database", "test.db"])

        self.assertEqual(result, 0)
        mock_repository.assert_called_once_with(Path("test.db"))
        mock_store.assert_called_once_with(mock_repo_instance.connection)
        self.assertIn("Stored group relevance run 42 in test.db", fake_out.getvalue())

    @patch("kpop_scraping.group_relevance_score_cli.argparse.ArgumentParser.exit")
    def test_missing_database_argument(self, mock_exit):
        mock_exit.side_effect = SystemExit(2)
        with patch("sys.stderr", new=StringIO()):
            with self.assertRaises(SystemExit):
                main([])
        mock_exit.assert_called()

    @patch("kpop_scraping.group_relevance_score_cli.argparse.ArgumentParser.exit")
    @patch("kpop_scraping.group_relevance_score_cli.Repository")
    def test_os_error(self, mock_repository, mock_exit):
        mock_repository.side_effect = OSError("Permission denied")
        mock_exit.side_effect = SystemExit(1)

        with self.assertRaises(SystemExit):
            main(["--database", "test.db"])

        mock_exit.assert_called_once_with(1, "Relevance scoring failed: Permission denied\n")

    @patch("kpop_scraping.group_relevance_score_cli.argparse.ArgumentParser.exit")
    @patch("kpop_scraping.group_relevance_score_cli.Repository")
    @patch("kpop_scraping.group_relevance_score_cli.store_relevance_scores")
    def test_relevance_score_error(self, mock_store, mock_repository, mock_exit):
        mock_repo_instance = MagicMock()
        mock_repository.return_value.__enter__.return_value = mock_repo_instance
        mock_store.side_effect = RelevanceScoreError("Calculation failed")
        mock_exit.side_effect = SystemExit(1)

        with self.assertRaises(SystemExit):
            main(["--database", "test.db"])

        mock_exit.assert_called_once_with(1, "Relevance scoring failed: Calculation failed\n")

    @patch("kpop_scraping.group_relevance_score_cli.argparse.ArgumentParser.exit")
    @patch("kpop_scraping.group_relevance_score_cli.Repository")
    @patch("kpop_scraping.group_relevance_score_cli.store_relevance_scores")
    def test_sqlite3_error(self, mock_store, mock_repository, mock_exit):
        mock_repo_instance = MagicMock()
        mock_repository.return_value.__enter__.return_value = mock_repo_instance
        mock_store.side_effect = sqlite3.Error("Database locked")
        mock_exit.side_effect = SystemExit(1)

        with self.assertRaises(SystemExit):
            main(["--database", "test.db"])

        mock_exit.assert_called_once_with(1, "Relevance scoring failed: Database locked\n")

if __name__ == "__main__":
    unittest.main()
