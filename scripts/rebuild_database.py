#!/usr/bin/env python3
"""Rebuild the database in bounded attempts and restore the cached copy when that fails.

``daily-puzzles-cron`` calls this script from two steps, so a rebuild that
hangs cannot take the fallback down with it
(``docs/decisions/032-rebuild-com-fallback-em-passo-separado.md``):

``rebuild``
    Copies the database to ``<database>.cached`` and runs the collector, the
    command after ``--``, at most 3 times. Each attempt has its own timeout.
    Only an attempt that exits with ``EXIT_TRANSIENT`` is repeated, after a
    wait. A deterministic failure, an unknown exit code and an attempt killed
    by its timeout end the step at once, because the same command would fail
    the same way. The step exits with the code of the last attempt, or 124
    when the timeout killed it. SIGINT or SIGTERM kills the running attempt
    and ends the script with 130 or 143.

``restore-cache``
    Runs when the ``rebuild`` step failed or timed out. Deletes the raw
    snapshots and the SQLite ``-journal``, ``-wal`` and ``-shm`` files the
    attempts left behind, puts the cached copy back and emits the
    ``Database not refreshed`` warning. Fails when there is no cached copy.

The workflow runs::

    exec python3 scripts/rebuild_database.py rebuild --database data/kpop.db -- \\
        python main.py --facts --releases --database data/kpop.db
    python3 scripts/rebuild_database.py restore-cache --database data/kpop.db

When a step passes ``timeout-minutes`` or the run is cancelled, the runner
sends SIGINT, then SIGTERM, then SIGKILL to the PID of the step's shell and to
no other process. ``exec`` makes that PID this script's, so the signal reaches
the code that stops the attempt.

The attempt limits come from the environment, so tests do not wait minutes:
``REBUILD_MAX_ATTEMPTS`` (3), ``REBUILD_ATTEMPT_TIMEOUT_SECONDS`` (1800),
``REBUILD_RETRY_WAIT_SECONDS`` (600) and ``REBUILD_KILL_GRACE_SECONDS`` (30).

Importing the module runs nothing: the collector only starts from ``rebuild``.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

# Ensure repo root is on sys.path when invoked directly as scripts/rebuild_database.py
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kpop_scraping.exit_codes import EXIT_DETERMINISTIC, EXIT_OK, EXIT_TRANSIENT

DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_ATTEMPT_TIMEOUT_SECONDS = 30 * 60.0
DEFAULT_RETRY_WAIT_SECONDS = 10 * 60.0
# Time between SIGTERM and SIGKILL for an attempt that passed its timeout.
DEFAULT_KILL_GRACE_SECONDS = 30.0

# Exit codes of this script that do not come from the collector.
EXIT_USAGE = 2
EXIT_ATTEMPT_TIMED_OUT = 124  # the code timeout(1) uses
EXIT_COMMAND_NOT_STARTED = 127  # the code a shell uses for a missing command

BACKUP_SUFFIX = ".cached"
# Signals that stop this script; each kills the running attempt first.
STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM)
# Files SQLite keeps beside a database while a transaction is open.
SQLITE_SIDECAR_SUFFIXES = ("-journal", "-wal", "-shm")


@dataclass(frozen=True)
class Limits:
    """How many attempts the rebuild gets and how long each one may take."""

    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    attempt_timeout: float = DEFAULT_ATTEMPT_TIMEOUT_SECONDS
    retry_wait: float = DEFAULT_RETRY_WAIT_SECONDS
    kill_grace: float = DEFAULT_KILL_GRACE_SECONDS

    def worst_case_seconds(self) -> float:
        """Longest the ``rebuild`` step can run: every attempt killed late, every wait taken."""
        return (
            self.max_attempts * (self.attempt_timeout + self.kill_grace)
            + (self.max_attempts - 1) * self.retry_wait
        )


def limits_from_environment(environ: Mapping[str, str]) -> Limits:
    """Read the limits, falling back to the defaults for unset or empty variables."""

    def number(name: str, default: float, minimum: float) -> float:
        text = environ.get(name, "").strip()
        if not text:
            return default
        try:
            value = float(text)
        except ValueError:
            value = math.nan
        # NaN fails every comparison, so "nan" and unreadable text end here too.
        if not minimum <= value < math.inf:
            raise ValueError(f"{name} must be a number of at least {minimum:g}, got {text!r}")
        return value

    attempts = number("REBUILD_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1)
    if attempts != int(attempts):
        raise ValueError(f"REBUILD_MAX_ATTEMPTS must be a whole number, got {attempts:g}")
    return Limits(
        max_attempts=int(attempts),
        attempt_timeout=number("REBUILD_ATTEMPT_TIMEOUT_SECONDS", DEFAULT_ATTEMPT_TIMEOUT_SECONDS, 0.001),
        retry_wait=number("REBUILD_RETRY_WAIT_SECONDS", DEFAULT_RETRY_WAIT_SECONDS, 0),
        kill_grace=number("REBUILD_KILL_GRACE_SECONDS", DEFAULT_KILL_GRACE_SECONDS, 0),
    )


def backup_path(database: Path) -> Path:
    return database.with_name(database.name + BACKUP_SUFFIX)


def run_attempt(command: Sequence[str], timeout: float, kill_grace: float) -> int | None:
    """Run one attempt and return its exit code, or ``None`` when the timeout killed it."""
    process = subprocess.Popen(list(command))
    try:
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=kill_grace)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        return None
    finally:
        # Reached with the attempt alive only when SIGINT or SIGTERM stopped
        # this script (a cancelled run, the step timeout; see
        # _stop_attempt_on_signals). Do not leave it writing to a database the
        # next step is about to replace.
        if process.poll() is None:
            process.kill()
            process.wait()


def rebuild(database: Path, command: Sequence[str], limits: Limits) -> int:
    """Run the collector until it succeeds, fails for good or runs out of attempts."""
    database.parent.mkdir(parents=True, exist_ok=True)
    backup = backup_path(database)
    if database.is_file():
        _copy_whole(database, backup)

    for attempt in range(1, limits.max_attempts + 1):
        label = f"Rebuild attempt {attempt} of {limits.max_attempts}"
        _log(f"{label}: {' '.join(command)}")
        try:
            code = run_attempt(command, limits.attempt_timeout, limits.kill_grace)
        except OSError as error:
            return _give_up(f"the rebuild command could not start ({error})", EXIT_COMMAND_NOT_STARTED)
        if code == EXIT_OK:
            backup.unlink(missing_ok=True)
            _log(f"{label} refreshed the database")
            return EXIT_OK
        if code is None:
            return _give_up(
                f"attempt {attempt} passed its {_duration(limits.attempt_timeout)} timeout and was stopped",
                EXIT_ATTEMPT_TIMED_OUT,
            )
        if code != EXIT_TRANSIENT:
            kind = "a deterministic error" if code == EXIT_DETERMINISTIC else "an unexpected error"
            # A negative code is the signal that ended the attempt.
            status = 128 - code if code < 0 else code
            return _give_up(f"attempt {attempt} ended in {kind} (exit {status})", status)
        if attempt < limits.max_attempts:
            _log(
                f"{label} ended in a transient error (exit {code}); "
                f"retrying in {_duration(limits.retry_wait)}"
            )
            time.sleep(limits.retry_wait)
    return _give_up(
        f"all {limits.max_attempts} attempts ended in a transient error (exit {EXIT_TRANSIENT})",
        EXIT_TRANSIENT,
    )


def _copy_whole(source: Path, target: Path) -> None:
    """Copy ``source`` to ``target`` so that ``target`` is either complete or absent.

    A copy cut short (a full disk) would otherwise sit at ``target``, and
    restore-cache would move it over the intact database.
    """
    partial = target.with_name(target.name + ".tmp")
    # A copy left by an earlier run is stale; it must not survive a failed copy.
    target.unlink(missing_ok=True)
    try:
        # copyfile gives the copy the time it ran as its mtime, and os.replace
        # keeps it; restore-cache relies on that to tell which raw snapshots
        # the attempts wrote.
        shutil.copyfile(source, partial)
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)


def restore_cache(database: Path, raw_dir: Path, reason: str) -> int:
    """Put the cached database back after a rebuild that did not finish."""
    backup = backup_path(database)
    if not backup.is_file():
        print("::error::Rebuild failed and no cached database is available", flush=True)
        return 1
    # The failed attempts wrote raw snapshots that the restored database does
    # not reference. Delete them so they do not reach the cache. Only files
    # written after the rebuild started are newer than the backup.
    removed = _delete_files_newer_than(raw_dir, backup.stat().st_mtime_ns)
    # An attempt stopped in the middle of a transaction leaves its journal
    # beside the database. It belongs to the discarded file: on the next open
    # SQLite would roll its pages back into the restored one.
    for suffix in SQLITE_SIDECAR_SUFFIXES:
        database.with_name(database.name + suffix).unlink(missing_ok=True)
    os.replace(backup, database)
    _log(f"Restored {database} from the cached copy; deleted {removed} raw snapshots of the failed rebuild")
    cause = f"Rebuild failed: {reason}" if reason else "Rebuild did not finish"
    print(
        f"::warning title=Database not refreshed::{_escape(cause)}; puzzles use the cached database",
        flush=True,
    )
    return EXIT_OK


def _delete_files_newer_than(directory: Path, mtime_ns: int) -> int:
    removed = 0
    if not directory.is_dir():
        return removed
    for folder, _subfolders, names in os.walk(directory):
        for name in names:
            path = Path(folder, name)
            if not path.is_symlink() and path.stat().st_mtime_ns > mtime_ns:
                path.unlink()
                removed += 1
    return removed


def _stop_attempt_on_signals() -> None:
    """Turn SIGINT and SIGTERM into ``SystemExit(128 + signal)``.

    ``run_attempt`` kills the attempt on the way out, and the script ends with
    130 (SIGINT) or 143 (SIGTERM) without a traceback. The runner sends SIGINT
    first when the step times out or the run is cancelled; Python's default
    would raise ``KeyboardInterrupt`` and print a traceback.
    """

    def handler(signum: int, _frame: object) -> None:
        name = signal.Signals(signum).name
        # os.write, because print may be in the middle of a write to stdout.
        os.write(1, f"Rebuild stopped by {name}; killing the running attempt\n".encode())
        raise SystemExit(128 + signum)

    for stop_signal in STOP_SIGNALS:
        signal.signal(stop_signal, handler)


def _give_up(reason: str, code: int) -> int:
    """Report why the database was not refreshed; the next step reads the reason."""
    _log(f"Rebuild failed: {reason}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"failure={' '.join(reason.split())}\n")
    return code


def _duration(seconds: float) -> str:
    minutes = seconds / 60
    return f"{minutes:g} min" if minutes >= 1 and minutes == int(minutes) else f"{seconds:g} s"


def _escape(text: str) -> str:
    """Escape a value for a workflow command, which ends at the line break."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _log(message: str) -> None:
    # Flushed so the line lands before the attempt's own output in the log.
    print(message, flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild the database in bounded attempts, or restore its cached copy."
    )
    commands = parser.add_subparsers(dest="action", required=True)
    run = commands.add_parser(
        "rebuild", help="Run the collector command given after -- until it succeeds or fails for good"
    )
    run.add_argument("--database", type=Path, required=True, help="Database the collector rebuilds")
    restore = commands.add_parser(
        "restore-cache", help="Put the cached database back after a failed rebuild"
    )
    restore.add_argument("--database", type=Path, required=True, help="Database to restore")
    restore.add_argument(
        "--raw-dir", type=Path,
        help="Snapshot directory; defaults to a raw directory beside the database",
    )
    restore.add_argument(
        "--reason", default=os.environ.get("REBUILD_FAILURE", ""),
        help="Why the rebuild failed, for the warning (default: $REBUILD_FAILURE)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    command: list[str] = []
    if "--" in arguments:
        split = arguments.index("--")
        arguments, command = arguments[:split], arguments[split + 1:]
    parser = build_parser()
    args = parser.parse_args(arguments)
    if args.action == "restore-cache":
        if command:
            parser.error("restore-cache takes no command")
        return restore_cache(args.database, args.raw_dir or args.database.parent / "raw", args.reason)
    if not command:
        parser.error("rebuild needs the collector command after --")
    try:
        limits = limits_from_environment(os.environ)
    except ValueError as error:
        print(f"::error::{error}", file=sys.stderr)
        return EXIT_USAGE
    _stop_attempt_on_signals()
    return rebuild(args.database, command, limits)


if __name__ == "__main__":
    raise SystemExit(main())
