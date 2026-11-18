import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import rebuild_phases
from kpop_scraping.cli import main
from kpop_scraping.exit_codes import EXIT_TRANSIENT
from kpop_scraping.mediawiki import MaxlagBudget, MediaWikiClient


class _Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class _JSONResponse(io.BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class PhaseLogTest(unittest.TestCase):
    def test_time_goes_to_the_innermost_phase(self):
        clock = _Clock()
        log = rebuild_phases.PhaseLog(clock)
        with log.phase("extraction"):
            clock.now = 1.0
            with log.phase("download"):
                clock.now = 4.0
                with log.phase("storage"):
                    clock.now = 4.5
                clock.now = 5.0
            clock.now = 7.0
        clock.now = 8.0
        self.assertEqual(log.totals["extraction"].seconds, 3.0)
        self.assertEqual(log.totals["download"].seconds, 3.5)
        self.assertEqual(log.totals["storage"].seconds, 0.5)
        lines = log.report_lines()
        self.assertIn("Rebuild phase download: 3.5s, 0 requests, 0.0s maxlag wait", lines)
        self.assertEqual(lines[-1], "Rebuild total: 8.0s (1.0s outside the phases), 0 requests, 0.0s maxlag wait")

    def test_unknown_phase_is_refused(self):
        with self.assertRaises(ValueError):
            with rebuild_phases.PhaseLog().phase("parsing"):
                pass

    def test_helpers_do_nothing_without_an_installed_log(self):
        self.assertIsNone(rebuild_phases.active())
        with rebuild_phases.phase("download"):
            rebuild_phases.count_request("download")
            rebuild_phases.add_maxlag_wait("download", 5)
            rebuild_phases.count_reuse("pages", reused=1)

    def test_timed_function_counts_as_its_phase(self):
        clock = _Clock()
        log = rebuild_phases.PhaseLog(clock)

        @rebuild_phases.timed("storage")
        def write():
            clock.now += 2.0
            return "written"

        with rebuild_phases.install(log):
            self.assertEqual(write(), "written")
        self.assertEqual(log.totals["storage"].seconds, 2.0)
        self.assertIsNone(rebuild_phases.active())

    def test_reuse_counts_are_reported_by_kind(self):
        log = rebuild_phases.PhaseLog()
        log.count_reuse("wikidata subject-v1", reused=40, fetched=10)
        log.count_reuse("wikidata subject-v1", reused=2)
        self.assertIn(
            "Rebuild reuse wikidata subject-v1: 42 reused from stored revisions, 10 fetched",
            log.report_lines(),
        )


class ClientPhaseTest(unittest.TestCase):
    @patch("kpop_scraping.http_request.urlopen")
    def test_requests_and_maxlag_waits_count_in_the_request_phase(self, urlopen):
        maxlag = b'{"error":{"code":"maxlag","info":"lagged","lag":7}}'
        members = b'{"query":{"categorymembers":[{"pageid":1,"title":"A"}]}}'
        answers = iter([_JSONResponse(maxlag, {"Retry-After": "5"}), _JSONResponse(members)])
        urlopen.side_effect = lambda *_args, **_kwargs: next(answers)
        log = rebuild_phases.PhaseLog()
        client = MediaWikiClient(maxlag_budget=MaxlagBudget(60, sleep=lambda _seconds: None))
        with rebuild_phases.install(log):
            self.assertEqual(len(list(client.iter_category_members("Category:Test"))), 1)
        self.assertEqual(log.totals["listing"].requests, 2)
        self.assertEqual(log.totals["listing"].maxlag_wait, 7.0)
        self.assertEqual(log.totals["download"].requests, 0)


class CLIPhaseReportTest(unittest.TestCase):
    @patch("kpop_scraping.mediawiki.time.sleep")
    @patch("kpop_scraping.http_request.urlopen")
    def test_failed_run_still_prints_every_phase(self, urlopen, _sleep):
        maxlag = b'{"error":{"code":"maxlag","info":"Waiting for wdqs1011: 9.6 seconds lagged."}}'
        urlopen.side_effect = lambda *_args, **_kwargs: _JSONResponse(maxlag, {"Retry-After": "10"})
        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"MAXLAG_BUDGET_SECONDS": "25"}
        ), redirect_stdout(stdout):
            exit_code = main(["--database", str(Path(directory) / "kpop.db")])
        self.assertEqual(exit_code, EXIT_TRANSIENT)
        output = stdout.getvalue()
        self.assertIn("Rebuild phase listing: ", output)
        self.assertIn(", 4 requests, 25.0s maxlag wait", output)
        for name in rebuild_phases.PHASES:
            self.assertIn(f"Rebuild phase {name}: ", output)
        self.assertLess(output.index("Pipeline failed"), output.index("Rebuild total: "))

    @unittest.skipIf(os.name == "nt", "SIGTERM is POSIX")
    def test_sigterm_ends_the_run_with_143_after_the_phase_report(self):
        import signal
        import time

        def stopped_run(*_args):
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(5)
            raise AssertionError("SIGTERM did not stop the run")

        before = signal.getsignal(signal.SIGTERM)
        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch(
            "kpop_scraping.cli._run", side_effect=stopped_run
        ), redirect_stdout(stdout), self.assertRaises(SystemExit) as raised:
            main(["--database", str(Path(directory) / "kpop.db")])
        self.assertEqual(raised.exception.code, 143)
        self.assertIn("Rebuild total: ", stdout.getvalue())
        self.assertIs(signal.getsignal(signal.SIGTERM), before)


if __name__ == "__main__":
    unittest.main()
