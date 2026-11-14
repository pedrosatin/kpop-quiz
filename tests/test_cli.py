import argparse
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch, MagicMock

from kpop_scraping.cli import build_parser, main
from kpop_scraping.exit_codes import EXIT_DETERMINISTIC, EXIT_TRANSIENT
from kpop_scraping.mediawiki import MediaWikiError
from kpop_scraping.storage import SnapshotIntegrityError


class _JSONResponse(io.BytesIO):
    def __init__(self, content, headers):
        super().__init__(content)
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


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
        self.assertEqual(exit_code, EXIT_DETERMINISTIC)
        output = stdout.getvalue()
        self.assertIn("Pipeline failed: RuntimeError: Test error", output)

    @patch("kpop_scraping.cli.Repository")
    def test_exit_code_tells_transient_failures_from_deterministic_ones(self, mock_repo):
        cases = (
            (MediaWikiError("MediaWiki error maxlag: 9.6 seconds lagged", code="maxlag", transient=True), EXIT_TRANSIENT),
            (MediaWikiError("WDQS request failed with HTTP 503", transient=True), EXIT_TRANSIENT),
            (MediaWikiError("WDQS candidate limit exceeded for Q1"), EXIT_DETERMINISTIC),
            (MediaWikiError("MediaWiki request failed with HTTP 404", code="http_404"), EXIT_DETERMINISTIC),
            (SnapshotIntegrityError("snapshot hash differs"), EXIT_DETERMINISTIC),
            (ValueError("no accepted catalog groups are available"), EXIT_DETERMINISTIC),
        )
        for error, expected in cases:
            with self.subTest(str(error)):
                mock_repo.side_effect = error
                stdout = io.StringIO()
                with redirect_stdout(stdout):
                    exit_code = main(["--database", str(self.database)])
                self.assertEqual(exit_code, expected)
                self.assertIn(f"Pipeline failed: {type(error).__name__}: {error}", stdout.getvalue())

    @patch("kpop_scraping.cli.Repository")
    @patch("kpop_scraping.cli.collect_category", return_value=0)
    @patch("kpop_scraping.cli.classify_catalog")
    @patch("kpop_scraping.cli.extract_facts")
    @patch("kpop_scraping.cli.export_fact_coverage_csv", return_value=0)
    @patch("kpop_scraping.cli.discover_releases")
    @patch("kpop_scraping.cli.collect_release_facts")
    @patch("kpop_scraping.cli.export_release_coverage_csv", return_value=0)
    @patch("kpop_scraping.cli.WikidataQueryClient")
    @patch("kpop_scraping.cli.WikidataEntityClient")
    @patch("kpop_scraping.cli.WikidataTypeClient")
    @patch("kpop_scraping.cli.MediaWikiClient")
    def test_every_wikimedia_client_of_the_run_shares_one_maxlag_budget(
        self, mediawiki, type_client, entity_client, *_mocks
    ):
        with patch.dict(os.environ, {"MAXLAG_BUDGET_SECONDS": "120"}), redirect_stdout(io.StringIO()):
            self.assertEqual(main(["--database", str(self.database), "--releases"]), 0)
        calls = [*mediawiki.call_args_list, *type_client.call_args_list, *entity_client.call_args_list]
        # Category, wikitext and the three release languages; types; facts and releases.
        self.assertEqual(len(calls), 8)
        budgets = {id(call.kwargs["maxlag_budget"]) for call in calls}
        self.assertEqual(len(budgets), 1)
        self.assertEqual(calls[0].kwargs["maxlag_budget"].seconds, 120.0)

    def test_invalid_maxlag_budget_stops_before_the_run(self):
        with patch.dict(os.environ, {"MAXLAG_BUDGET_SECONDS": "-5"}), self.assertRaises(SystemExit) as raised:
            main(["--database", str(self.database)])
        self.assertIn("MAXLAG_BUDGET_SECONDS must be a number of seconds", str(raised.exception))

    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_maxlag_past_the_budget_exits_as_transient(self, urlopen, sleep):
        maxlag = b'{"error":{"code":"maxlag","info":"Waiting for wdqs1011: 9.6 seconds lagged."}}'
        urlopen.side_effect = lambda *_args, **_kwargs: _JSONResponse(maxlag, {"Retry-After": "10"})
        stdout = io.StringIO()
        with patch.dict(os.environ, {"MAXLAG_BUDGET_SECONDS": "25"}), redirect_stdout(stdout):
            exit_code = main(["--database", str(self.database)])
        self.assertEqual(exit_code, EXIT_TRANSIENT)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [10.0, 10.0, 5.0])
        self.assertIn(
            "Pipeline failed: MediaWikiError: MediaWiki maxlag at https://en.wikipedia.org/w/api.php "
            "did not clear within the run's 25s wait budget (MAXLAG_BUDGET_SECONDS); "
            "last answer: Waiting for wdqs1011: 9.6 seconds lagged.",
            stdout.getvalue(),
        )

    @patch("kpop_scraping.cli.Repository")
    def test_unexpected_exception_keeps_the_generic_exit_code(self, mock_repo):
        # main() does not catch it, so Python ends the process with code 1,
        # which the rebuild does not repeat.
        mock_repo.side_effect = OSError("disk is gone")
        with self.assertRaises(OSError):
            main(["--database", str(self.database)])


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
