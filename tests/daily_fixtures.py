"""Daily sets generated once per test process and copied into each test.

A run of the daily runner generates every game of the day, and the quiz
takes most of it (about two seconds a day, mostly validating each session
against its dataset). The tests of promotion, rollback and omission need a
valid set to start from and a run in which only the game under test fails,
not a new generation of everything:

- ``published_set`` copies into the test a set published by real runs,
  made once per process in a temporary directory;
- ``reuse_quiz`` serves the quiz of a run from a copy generated once per
  database content and day, so the run under test still generates, checks
  and publishes the other games for real.

Each test gets its own copy of both, and nothing a test changes reaches
another one. The generation and determinism tests do not use this module,
and each flow keeps at least one test that generates for real.
"""

from __future__ import annotations

import hashlib
import io
import pickle
import shutil
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any, Callable
from unittest.mock import patch

from kpop_scraping import daily_puzzles_runner
from kpop_scraping.daily_puzzles_runner import run_daily_puzzles

_real_generate_quiz = daily_puzzles_runner._generate_quiz
_workspace: tempfile.TemporaryDirectory | None = None
_sets: dict[tuple, tuple[Path, list[dict[str, Any]]]] = {}
_quizzes: dict[tuple, bytes] = {}


def _root() -> Path:
    # Removed when the process exits (TemporaryDirectory's finalizer).
    global _workspace
    if _workspace is None:
        _workspace = tempfile.TemporaryDirectory(prefix="daily_fixtures_")
    return Path(_workspace.name)


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _generate_quiz_once(
    connection: sqlite3.Connection,
    iso_date: str,
    base_seed: str,
    timer_seconds: int | None,
    related_clues: bool,
) -> dict[str, Any]:
    """``_generate_quiz`` keyed by the database content and its arguments.

    A test that changes its database gets a quiz generated from the change.
    """
    key = (_digest(connection.serialize()), iso_date, base_seed, timer_seconds, related_clues)
    if key not in _quizzes:
        _quizzes[key] = pickle.dumps(
            _real_generate_quiz(connection, iso_date, base_seed, timer_seconds, related_clues)
        )
    return pickle.loads(_quizzes[key])


def reuse_quiz(test: unittest.TestCase) -> None:
    """Serve the quiz of every run in ``test`` from ``_generate_quiz_once``."""
    test.enterContext(patch.object(daily_puzzles_runner, "_generate_quiz", _generate_quiz_once))


def _rebased(value: Any, source: str, target: str) -> Any:
    if isinstance(value, str):
        return value.replace(source, target)
    if isinstance(value, dict):
        return {key: _rebased(item, source, target) for key, item in value.items()}
    if isinstance(value, list):
        return [_rebased(item, source, target) for item in value]
    return value


def published_set(
    target: Path,
    database: Path,
    *runs: dict[str, Any],
    seed: Callable[[Path], None] | None = None,
) -> list[dict[str, Any]]:
    """Copy into ``target`` the set that ``runs`` publish from ``database``.

    Each run is the keyword arguments of one ``run_daily_puzzles`` call
    after ``database`` and ``output_dir``; ``seed`` writes files into the
    empty output directory before the first run. The set is generated once
    per process for the same database content, runs and seed, with the quiz
    of ``reuse_quiz``. Returns the result of each run, with paths pointing
    at ``target``.
    """
    if seed is not None and "<" in seed.__qualname__:
        raise ValueError("seed must be a named function: its name keys the set")
    key = (
        _digest(Path(database).read_bytes()),
        tuple(tuple(sorted(run.items())) for run in runs),
        None if seed is None else f"{seed.__module__}.{seed.__qualname__}",
    )
    if key not in _sets:
        work = Path(tempfile.mkdtemp(dir=_root()))
        source = work / "data"
        source.mkdir()
        if seed is not None:
            seed(source)
        results = []
        with patch.object(daily_puzzles_runner, "_generate_quiz", _generate_quiz_once), \
                redirect_stderr(io.StringIO()):
            for run in runs:
                results.append(run_daily_puzzles(database=database, output_dir=source, **run))
        _sets[key] = (source, results)
    source, results = _sets[key]
    shutil.copytree(source, target, dirs_exist_ok=True)
    return _rebased(results, str(source), str(target))
