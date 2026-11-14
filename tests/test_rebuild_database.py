"""The nightly rebuild step: bounded attempts, then the cached database in a step of its own.

The end-to-end cases run ``scripts/rebuild_database.py`` as the workflow does,
with ``tests/fixtures/fake_collector.py`` in the place of ``main.py``.
"""

from __future__ import annotations

import io
import os
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr, suppress
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.exit_codes import (
    EXIT_DETERMINISTIC,
    EXIT_OK,
    EXIT_TRANSIENT,
    RESERVED_EXIT_CODES,
)
from scripts.rebuild_database import (
    EXIT_ATTEMPT_TIMED_OUT,
    EXIT_COMMAND_NOT_STARTED,
    EXIT_USAGE,
    Limits,
    limits_from_environment,
    main,
    rebuild,
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "rebuild_database.py"
FAKE_COLLECTOR = ROOT / "tests" / "fixtures" / "fake_collector.py"
WORKFLOW = ROOT / ".github" / "workflows" / "daily-puzzles-cron.yml"

REBUILD_STEP = "Rebuild database from Wikipedia and Wikidata"
RESTORE_STEP = "Restore cached database"
WARNING = "::warning title=Database not refreshed::"
# Long enough to show that a wait which must not happen did not happen.
LONG_WAIT_SECONDS = "600"
# What the runner does to a step that passed timeout-minutes or a cancelled
# run (actions/runner, ProcessInvoker.cs): SIGINT, then SIGTERM, then SIGKILL,
# each sent to the PID of the step's shell only, with these waits between them.
RUNNER_STOP_SEQUENCE = ((signal.SIGINT, 7.5), (signal.SIGTERM, 2.5), (signal.SIGKILL, 60))


class JobResult:
    """What the two steps of the job left behind."""

    def __init__(self, rebuild, restore, files_after_rebuild, elapsed):
        self.rebuild = rebuild
        self.restore = restore
        self.files_after_rebuild = files_after_rebuild
        self.elapsed = elapsed


@unittest.skipIf(os.name == "nt", "attempts are stopped with POSIX signals")
class RebuildJobTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.data = self.folder / "data"
        self.database = self.data / "kpop.db"
        self.raw = self.data / "raw"
        self.log = self.folder / "collector.log"
        self.step_output = self.folder / "github-output"

    def cache_database(self) -> None:
        """Leave the database and the snapshot the cache step would restore."""
        self.raw.mkdir(parents=True)
        (self.raw / "cached.json").write_text("{}", encoding="utf-8")
        with sqlite3.connect(self.database) as connection:
            connection.execute("CREATE TABLE facts (value TEXT)")
            connection.execute("INSERT INTO facts VALUES ('cached')")
        connection.close()

    def run_script(self, *arguments: str, **environment: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            cwd=self.folder,
            env={**os.environ, "GITHUB_OUTPUT": str(self.step_output), **environment},
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )

    def run_job(self, outcomes: str, **limits: str) -> JobResult:
        """Run the rebuild step and, only when it fails, the restore step."""
        started = time.monotonic()
        rebuild = self.run_script(
            "rebuild", "--database", "data/kpop.db", "--",
            sys.executable, str(FAKE_COLLECTOR), "--facts", "--releases", "--database", "data/kpop.db",
            FAKE_COLLECTOR_LOG=str(self.log),
            FAKE_COLLECTOR_OUTCOMES=outcomes,
            **limits,
        )
        elapsed = time.monotonic() - started
        files = sorted(path.name for path in self.data.iterdir()) if self.data.is_dir() else []
        restore = None
        if rebuild.returncode != 0:  # steps.rebuild.outcome == 'failure'
            restore = self.run_script(
                "restore-cache", "--database", "data/kpop.db",
                REBUILD_FAILURE=self.step_outputs().get("failure", ""),
            )
        return JobResult(rebuild, restore, files, elapsed)

    def step_outputs(self) -> dict[str, str]:
        if not self.step_output.exists():
            return {}
        lines = self.step_output.read_text(encoding="utf-8").splitlines()
        return dict(line.split("=", 1) for line in lines)

    def collector_pids(self) -> list[int]:
        if not self.log.exists():
            return []
        return [int(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def facts(self) -> list[str]:
        """What the Generate step would read from the database."""
        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            return [row[0] for row in connection.execute("SELECT value FROM facts ORDER BY rowid")]
        finally:
            connection.close()

    def raw_files(self) -> list[str]:
        return sorted(path.name for path in self.raw.iterdir())

    def assert_published_from_cache(self, job: JobResult, reason: str) -> None:
        self.assertIsNotNone(job.restore, "the restore step did not run")
        self.assertEqual(job.restore.returncode, 0, job.restore.stdout + job.restore.stderr)
        self.assertIn(f"{WARNING}Rebuild failed: {reason}", job.restore.stdout)
        self.assertIn("puzzles use the cached database", job.restore.stdout)
        self.assertEqual(self.facts(), ["cached"])
        self.assertEqual(self.raw_files(), ["cached.json"])
        self.assertEqual(sorted(path.name for path in self.data.iterdir()), ["kpop.db", "raw"])

    def assert_not_running(self, pid: int) -> None:
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_hung_attempt_is_stopped_and_the_job_publishes_from_the_cache(self):
        self.cache_database()
        job = self.run_job(
            "hang",
            REBUILD_ATTEMPT_TIMEOUT_SECONDS="2",
            REBUILD_RETRY_WAIT_SECONDS=LONG_WAIT_SECONDS,
        )
        self.assertEqual(job.rebuild.returncode, EXIT_ATTEMPT_TIMED_OUT, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 1)
        self.assert_not_running(self.collector_pids()[0])
        self.assertLess(job.elapsed, 60)
        # The stopped attempt left its journal beside the database.
        self.assertIn("kpop.db-journal", job.files_after_rebuild)
        self.assert_published_from_cache(job, "attempt 1 passed its 2 s timeout and was stopped")

    def test_attempt_that_ignores_sigterm_is_killed(self):
        self.cache_database()
        job = self.run_job(
            "hang-ignoring-sigterm",
            REBUILD_ATTEMPT_TIMEOUT_SECONDS="2",
            REBUILD_KILL_GRACE_SECONDS="0.2",
        )
        self.assertEqual(job.rebuild.returncode, EXIT_ATTEMPT_TIMED_OUT, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 1)
        self.assert_not_running(self.collector_pids()[0])
        self.assert_published_from_cache(job, "attempt 1 passed its 2 s timeout and was stopped")

    def start_rebuild_step(self) -> subprocess.Popen:
        """Run the rebuild step's ``run:`` text the way the runner does.

        The runner writes the text to a file and runs ``bash -e <file>`` (the
        workflow sets no ``shell``). ``python3`` and ``python`` resolve to this
        interpreter, ``scripts/`` is the repository's, and ``main.py`` runs the
        fake collector, which hangs inside a transaction.
        """
        tools = self.folder / "bin"
        tools.mkdir()
        for name in ("python", "python3"):
            wrapper = tools / name
            wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n', encoding="utf-8")
            wrapper.chmod(0o755)
        (self.folder / "scripts").symlink_to(ROOT / "scripts", target_is_directory=True)
        (self.folder / "main.py").write_text(
            f"import runpy\nrunpy.run_path({str(FAKE_COLLECTOR)!r}, run_name='__main__')\n",
            encoding="utf-8",
        )
        script = self.folder / "step.sh"
        script.write_text(run_block(REBUILD_STEP), encoding="utf-8")
        self.step_log = self.folder / "step.log"
        with self.step_log.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                ["bash", "-e", str(script)],
                cwd=self.folder,
                env={
                    **os.environ,
                    "PATH": f"{tools}{os.pathsep}{os.environ.get('PATH', '')}",
                    "GITHUB_OUTPUT": str(self.step_output),
                    "FAKE_COLLECTOR_LOG": str(self.log),
                    "FAKE_COLLECTOR_OUTCOMES": "hang",
                },
                stdout=log,
                stderr=subprocess.STDOUT,
                # Its own process group, so the test can tell whether anything
                # the step started outlives it, and clean up if it does.
                start_new_session=True,
            )
        self.addCleanup(self.kill_process_group, process.pid)
        # Wait until the attempt holds an open transaction.
        journal = self.data / "kpop.db-journal"
        deadline = time.monotonic() + 60
        while not (self.collector_pids() and journal.exists()) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertTrue(journal.exists(), "the fake collector did not start its transaction")
        return process

    @staticmethod
    def kill_process_group(group: int) -> None:
        with suppress(ProcessLookupError):
            os.killpg(group, signal.SIGKILL)

    def assert_step_left_nothing_running(self, process: subprocess.Popen) -> None:
        self.assertEqual(len(self.collector_pids()), 1)
        self.assert_not_running(self.collector_pids()[0])
        # Nothing the step started is left to write to the database after the
        # restore step replaces it.
        with self.assertRaises(ProcessLookupError):
            os.killpg(process.pid, 0)
        log = self.step_log.read_text(encoding="utf-8")
        self.assertNotIn("Traceback", log)

    def assert_restore_publishes_the_cache(self) -> None:
        restore = self.run_script(
            "restore-cache", "--database", "data/kpop.db",
            REBUILD_FAILURE=self.step_outputs().get("failure", ""),
        )
        self.assertEqual(restore.returncode, 0, restore.stdout + restore.stderr)
        self.assertIn(f"{WARNING}Rebuild did not finish", restore.stdout)
        self.assertEqual(self.facts(), ["cached"])
        self.assertEqual(self.raw_files(), ["cached.json"])

    def test_runner_stopping_the_step_kills_the_attempt(self):
        # The runner signals the shell's PID; with `exec` that is this script.
        # Without it the signals reach bash alone, SIGTERM ends bash, and the
        # script and the collector keep writing while the restore step runs.
        self.cache_database()
        process = self.start_rebuild_step()

        sent = []
        for stop_signal, wait in RUNNER_STOP_SEQUENCE:
            os.kill(process.pid, stop_signal)
            sent.append(stop_signal)
            with suppress(subprocess.TimeoutExpired):
                process.wait(timeout=wait)
                break

        self.assertEqual(sent, [signal.SIGINT])
        self.assertEqual(process.returncode, 128 + signal.SIGINT)
        self.assertIn(
            "Rebuild stopped by SIGINT; killing the running attempt",
            self.step_log.read_text(encoding="utf-8"),
        )
        self.assert_step_left_nothing_running(process)
        self.assert_restore_publishes_the_cache()

    def test_sigterm_to_the_step_shell_kills_the_attempt(self):
        self.cache_database()
        process = self.start_rebuild_step()
        os.kill(process.pid, signal.SIGTERM)
        self.assertEqual(process.wait(timeout=60), 128 + signal.SIGTERM)
        self.assertIn("Rebuild stopped by SIGTERM", self.step_log.read_text(encoding="utf-8"))
        self.assert_step_left_nothing_running(process)
        self.assert_restore_publishes_the_cache()

    def test_deterministic_error_gets_one_attempt_then_the_cache(self):
        self.cache_database()
        job = self.run_job("deterministic", REBUILD_RETRY_WAIT_SECONDS=LONG_WAIT_SECONDS)
        self.assertEqual(job.rebuild.returncode, EXIT_DETERMINISTIC, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 1)
        self.assertLess(job.elapsed, 60)
        self.assert_published_from_cache(
            job, f"attempt 1 ended in a deterministic error (exit {EXIT_DETERMINISTIC})"
        )

    def test_uncaught_exception_gets_one_attempt_then_the_cache(self):
        self.cache_database()
        job = self.run_job("crash", REBUILD_RETRY_WAIT_SECONDS=LONG_WAIT_SECONDS)
        self.assertEqual(job.rebuild.returncode, 1, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 1)
        self.assert_published_from_cache(job, "attempt 1 ended in an unexpected error (exit 1)")

    def test_transient_error_gets_three_attempts_then_the_cache(self):
        self.cache_database()
        job = self.run_job("transient", REBUILD_RETRY_WAIT_SECONDS="0.05")
        self.assertEqual(job.rebuild.returncode, EXIT_TRANSIENT, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 3)
        self.assertEqual(job.rebuild.stdout.count("retrying in 0.05 s"), 2)
        self.assert_published_from_cache(
            job, f"all 3 attempts ended in a transient error (exit {EXIT_TRANSIENT})"
        )

    def test_transient_error_followed_by_success_refreshes_the_database(self):
        self.cache_database()
        job = self.run_job("transient,ok", REBUILD_RETRY_WAIT_SECONDS="0.05")
        self.assertEqual(job.rebuild.returncode, EXIT_OK, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 2)
        self.assertIsNone(job.restore)
        self.assertEqual(self.step_outputs(), {})
        self.assertEqual(self.facts(), ["cached", "attempt-1", "attempt-2"])
        self.assertEqual(self.raw_files(), ["attempt-1.json", "attempt-2.json", "cached.json"])
        self.assertNotIn("kpop.db.cached", job.files_after_rebuild)

    def test_first_attempt_that_succeeds_needs_no_retry_and_no_cache(self):
        job = self.run_job("ok", REBUILD_RETRY_WAIT_SECONDS=LONG_WAIT_SECONDS)
        self.assertEqual(job.rebuild.returncode, EXIT_OK, job.rebuild.stdout)
        self.assertEqual(len(self.collector_pids()), 1)
        self.assertIsNone(job.restore)
        self.assertEqual(self.facts(), ["attempt-1"])

    def test_attempt_limit_comes_from_the_environment(self):
        self.cache_database()
        job = self.run_job("transient", REBUILD_MAX_ATTEMPTS="2", REBUILD_RETRY_WAIT_SECONDS="0")
        self.assertEqual(job.rebuild.returncode, EXIT_TRANSIENT)
        self.assertEqual(len(self.collector_pids()), 2)

    def test_failed_rebuild_without_a_cached_database_fails_the_job(self):
        job = self.run_job("deterministic")
        self.assertEqual(job.rebuild.returncode, EXIT_DETERMINISTIC)
        self.assertEqual(job.restore.returncode, 1)
        self.assertIn("::error::Rebuild failed and no cached database is available", job.restore.stdout)
        self.assertNotIn(WARNING, job.restore.stdout)

    def test_restore_runs_after_a_rebuild_step_that_was_killed(self):
        # The step timeout stops the script before it reports a reason.
        self.cache_database()
        backup = self.data / "kpop.db.cached"
        backup.write_bytes(self.database.read_bytes())
        self.database.write_bytes(b"half written")
        for suffix in ("-journal", "-wal", "-shm"):
            (self.data / f"kpop.db{suffix}").write_bytes(b"left by the killed attempt")
        (self.raw / "nested").mkdir()
        orphan = self.raw / "nested" / "orphan.json"
        orphan.write_text("{}", encoding="utf-8")
        newer = backup.stat().st_mtime_ns + 1_000_000_000
        os.utime(orphan, ns=(newer, newer))

        restore = self.run_script("restore-cache", "--database", "data/kpop.db", REBUILD_FAILURE="")

        self.assertEqual(restore.returncode, 0, restore.stdout + restore.stderr)
        self.assertIn(f"{WARNING}Rebuild did not finish; puzzles use the cached database", restore.stdout)
        self.assertEqual(self.facts(), ["cached"])
        self.assertFalse(orphan.exists())
        self.assertEqual(sorted(path.name for path in self.data.iterdir()), ["kpop.db", "raw"])

    def test_failed_copy_leaves_the_database_and_no_cached_copy(self):
        # A full disk cuts the copy short. restore-cache would move a partial
        # copy over the intact database, so none may be left at kpop.db.cached,
        # not even a stale one from an earlier run.
        self.cache_database()
        backup = self.data / "kpop.db.cached"
        backup.write_bytes(b"stale copy from an earlier run")
        original = self.database.read_bytes()

        def copy_until_the_disk_fills(_source, target):
            Path(target).write_bytes(original[: len(original) // 2])
            raise OSError(28, "No space left on device")

        with (
            patch("scripts.rebuild_database.shutil.copyfile", copy_until_the_disk_fills),
            patch("scripts.rebuild_database.run_attempt") as run_attempt,
            self.assertRaises(OSError),
        ):
            rebuild(self.database, ["main.py"], Limits())

        run_attempt.assert_not_called()
        self.assertEqual(self.database.read_bytes(), original)
        self.assertEqual(sorted(path.name for path in self.data.iterdir()), ["kpop.db", "raw"])
        restore = self.run_script("restore-cache", "--database", "data/kpop.db")
        self.assertEqual(restore.returncode, 1)
        self.assertEqual(self.database.read_bytes(), original)

    def test_missing_command_fails_without_retrying(self):
        self.cache_database()
        rebuild = self.run_script(
            "rebuild", "--database", "data/kpop.db", "--", str(self.folder / "missing-collector"),
            REBUILD_RETRY_WAIT_SECONDS=LONG_WAIT_SECONDS,
        )
        self.assertEqual(rebuild.returncode, EXIT_COMMAND_NOT_STARTED, rebuild.stdout)
        self.assertEqual(rebuild.stdout.count("Rebuild attempt"), 1)
        self.assertIn("could not start", self.step_outputs()["failure"])


class LimitsTests(unittest.TestCase):
    def test_defaults_are_three_attempts_of_thirty_minutes_ten_minutes_apart(self):
        limits = limits_from_environment({})
        self.assertEqual(limits, Limits())
        self.assertEqual(
            (limits.max_attempts, limits.attempt_timeout, limits.retry_wait, limits.kill_grace),
            (3, 1800.0, 600.0, 30.0),
        )
        self.assertEqual(limits.worst_case_seconds(), 3 * 1830 + 2 * 600)

    def test_environment_replaces_each_limit(self):
        limits = limits_from_environment({
            "REBUILD_MAX_ATTEMPTS": "5",
            "REBUILD_ATTEMPT_TIMEOUT_SECONDS": "1.5",
            "REBUILD_RETRY_WAIT_SECONDS": "0",
            "REBUILD_KILL_GRACE_SECONDS": " 2 ",
        })
        self.assertEqual(limits, Limits(max_attempts=5, attempt_timeout=1.5, retry_wait=0.0, kill_grace=2.0))

    def test_invalid_limits_are_refused(self):
        for name, value in (
            ("REBUILD_MAX_ATTEMPTS", "0"),
            ("REBUILD_MAX_ATTEMPTS", "2.5"),
            ("REBUILD_ATTEMPT_TIMEOUT_SECONDS", "0"),
            ("REBUILD_ATTEMPT_TIMEOUT_SECONDS", "thirty"),
            ("REBUILD_ATTEMPT_TIMEOUT_SECONDS", "nan"),
            ("REBUILD_ATTEMPT_TIMEOUT_SECONDS", "inf"),
            ("REBUILD_RETRY_WAIT_SECONDS", "-1"),
            ("REBUILD_KILL_GRACE_SECONDS", "-0.5"),
        ):
            with self.subTest(name=name, value=value), self.assertRaisesRegex(ValueError, name):
                limits_from_environment({name: value})

    def test_invalid_limit_ends_the_step_before_any_attempt(self):
        stderr = io.StringIO()
        with (
            patch.dict(os.environ, {"REBUILD_MAX_ATTEMPTS": "none"}),
            patch("scripts.rebuild_database.rebuild") as rebuild,
            redirect_stderr(stderr),
        ):
            code = main(["rebuild", "--database", "data/kpop.db", "--", "python", "main.py"])
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("::error::REBUILD_MAX_ATTEMPTS", stderr.getvalue())
        rebuild.assert_not_called()

    def test_rebuild_without_a_command_is_a_usage_error(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            main(["rebuild", "--database", "data/kpop.db"])
        self.assertEqual(raised.exception.code, EXIT_USAGE)


class ExitCodeTests(unittest.TestCase):
    def test_collector_codes_do_not_collide_with_reserved_ones(self):
        failures = {EXIT_DETERMINISTIC, EXIT_TRANSIENT}
        self.assertEqual(len(failures), 2)
        self.assertEqual(EXIT_OK, 0)
        self.assertFalse(failures & RESERVED_EXIT_CODES)
        self.assertTrue({0, 1, 2, 124, 137, 143} <= RESERVED_EXIT_CODES)
        self.assertTrue({EXIT_USAGE, EXIT_ATTEMPT_TIMED_OUT, EXIT_COMMAND_NOT_STARTED}.isdisjoint(failures))


def job_steps(workflow: str, job: str) -> list[tuple[str, str]]:
    """Return ``(name, text)`` of each step of a job, in file order."""
    body = workflow.split(f"\n  {job}:\n", 1)[1]
    following_job = re.search(r"^  \S", body, flags=re.MULTILINE)
    if following_job:
        body = body[: following_job.start()]
    steps = re.split(r"^      - name: ", body, flags=re.MULTILINE)[1:]
    return [(step.split("\n", 1)[0].strip(), step) for step in steps]


def run_block(step_name: str) -> str:
    """Return the ``run: |`` text of a step of the daily job, as the runner writes it to a file."""
    step = dict(job_steps(WORKFLOW.read_text(encoding="utf-8"), "daily-puzzles"))[step_name]
    lines = step.split("\n        run: |\n", 1)[1].split("\n")
    block = []
    for line in lines:
        if line.strip() and not line.startswith(" " * 10):
            break
        block.append(line[10:])
    return "\n".join(block).strip("\n") + "\n"


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.steps = job_steps(WORKFLOW.read_text(encoding="utf-8"), "daily-puzzles")
        self.names = [name for name, _text in self.steps]
        self.text = dict(self.steps)

    def test_rebuild_step_execs_the_script(self):
        # The runner stops a step by signalling the shell's PID only. With
        # exec that PID is the script's, which kills the running attempt.
        commands = [line for line in run_block(REBUILD_STEP).splitlines() if line.strip()]
        self.assertTrue(
            commands[0].startswith("exec python3 scripts/rebuild_database.py rebuild "), commands
        )

    def test_rebuild_step_runs_the_script_and_lets_the_job_continue(self):
        step = self.text[REBUILD_STEP]
        self.assertIn("\n        id: rebuild\n", step)
        self.assertIn("\n        continue-on-error: true\n", step)
        self.assertRegex(
            step,
            r"python3 scripts/rebuild_database\.py rebuild --database data/kpop\.db -- \\\n"
            r"\s+python main\.py --facts --releases --database data/kpop\.db\n",
        )
        for inline in ("sleep", "kpop.db.cached", "for attempt"):
            self.assertNotIn(inline, step)

    def test_fallback_is_a_separate_step_tied_to_the_rebuild_outcome(self):
        position = self.names.index(REBUILD_STEP)
        self.assertEqual(self.names[position + 1], RESTORE_STEP)
        self.assertEqual(self.names[position + 2], "Generate daily puzzles")
        step = self.text[RESTORE_STEP]
        self.assertIn("\n        if: steps.rebuild.outcome == 'failure'\n", step)
        self.assertIn("REBUILD_FAILURE: ${{ steps.rebuild.outputs.failure }}", step)
        self.assertIn("python3 scripts/rebuild_database.py restore-cache --database data/kpop.db", step)

    def test_steps_after_the_fallback_run_as_after_a_successful_rebuild(self):
        # None of them carries a condition: with continue-on-error on the
        # rebuild step the job is still successful when they start.
        following = self.names[self.names.index(RESTORE_STEP) + 1:]
        self.assertEqual(following[:5], [
            "Generate daily puzzles",
            "Verify published artifacts",
            "Refuse undeclared board swaps",
            "Build static web app",
            "Detect changes in published data",
        ])
        for name in following[:5]:
            self.assertNotRegex(self.text[name], r"\n\s+if:", name)

    def test_attempts_and_waits_fit_in_the_step_timeout(self):
        step = self.text[REBUILD_STEP]
        timeout_minutes = int(re.search(r"\n        timeout-minutes: (\d+)\n", step).group(1))
        self.assertLess(Limits().worst_case_seconds(), timeout_minutes * 60)
        # The workflow does not override the limits the script documents.
        self.assertNotIn("REBUILD_MAX_ATTEMPTS", WORKFLOW.read_text(encoding="utf-8"))
        self.assertNotRegex(WORKFLOW.read_text(encoding="utf-8"), r"REBUILD_\w+_SECONDS")


if __name__ == "__main__":
    unittest.main()
