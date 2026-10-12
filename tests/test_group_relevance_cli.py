import io
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch, MagicMock

from kpop_scraping.group_relevance import PageviewError, WINDOW_DAYS
from kpop_scraping.group_relevance_cli import default_reference_date, main


class GroupRelevanceCliTest(unittest.TestCase):
    def test_default_reference_date_uses_utc(self):
        class FixedDatetime:
            @classmethod
            def now(cls, tz):
                self.assertIsNotNone(tz)
                return datetime(2026, 9, 21, 0, 30)

        with patch("kpop_scraping.group_relevance_cli.datetime", FixedDatetime):
            self.assertEqual(default_reference_date(), date(2026, 9, 21))

    @patch("sys.stderr", new_callable=io.StringIO)
    def test_main_requires_database_and_user_agent(self, mock_stderr):
        with self.assertRaises(SystemExit) as cm:
            main([])
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("the following arguments are required: --database, --user-agent", mock_stderr.getvalue())

    @patch("sys.stderr", new_callable=io.StringIO)
    def test_main_rejects_invalid_days_and_limit(self, mock_stderr):
        with self.assertRaises(SystemExit) as cm:
            main(["--database", "test.db", "--user-agent", "test", "--days", "0"])
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("--days and --limit must be positive", mock_stderr.getvalue())

        with self.assertRaises(SystemExit) as cm:
            main(["--database", "test.db", "--user-agent", "test", "--limit", "0"])
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("--days and --limit must be positive", mock_stderr.getvalue())

    @patch("kpop_scraping.group_relevance_cli.collect_group_pageviews")
    @patch("kpop_scraping.group_relevance_cli.Repository")
    @patch("sys.stderr", new_callable=io.StringIO)
    def test_main_handles_exceptions(self, mock_stderr, mock_repo, mock_collect):
        mock_repo.return_value.__enter__.return_value = MagicMock()
        mock_collect.side_effect = PageviewError("Network issue")

        with self.assertRaises(SystemExit) as cm:
            main(["--database", "test.db", "--user-agent", "test"])

        self.assertEqual(cm.exception.code, 1)
        self.assertIn("Pageview collection failed: Network issue", mock_stderr.getvalue())

    @patch("kpop_scraping.group_relevance_cli.collect_group_pageviews")
    @patch("kpop_scraping.group_relevance_cli.Repository")
    @patch("sys.stdout", new_callable=io.StringIO)
    def test_main_successful_execution(self, mock_stdout, mock_repo, mock_collect):
        mock_repo.return_value.__enter__.return_value = MagicMock()
        mock_collect.return_value = 5

        code = main(["--database", "test.db", "--user-agent", "test"])

        self.assertEqual(code, 0)
        self.assertIn("Collected 5 group pageview measurements into test.db", mock_stdout.getvalue())

if __name__ == "__main__":
    unittest.main()
