"""Unified daily puzzle generation and publishing runner.

Deterministically generates and atomically publishes the 6 daily K-pop puzzle games:
1. Daily bilingual quiz sessions (and session.pt-BR.json, session.en.json)
2. Intersection grid (grid.daily.json)
3. Connections puzzle (connections.daily.json)
4. Name guess puzzle (name-guess.daily.json)
5. Word search puzzle (word-search.daily.json)
6. Timeline puzzle (timeline.daily.json)
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .connections_generator import generate_connections_puzzle
from .grid_generator import generate_daily_grid
from .name_guess_generator import generate_name_guess_puzzle
from .quiz_generator import QuizConfig, create_session, generate_dataset
from .quiz_schema import validate_session, write_json_atomic
from .quiz_utils import reference_date_today
from .timeline_generator import generate_timeline_puzzle
from .web_publish import (
    CONNECTIONS_DAILY_FILENAME,
    DIFFICULTIES,
    GRID_DAILY_FILENAME,
    LOCALES,
    MANIFEST_FILENAME,
    NAME_GUESS_DAILY_FILENAME,
    TIMELINE_DAILY_FILENAME,
    WORD_SEARCH_DAILY_FILENAME,
    create_daily_sessions,
    create_decade_sessions,
    parse_daily_date,
    publish,
    verify_artifacts,
)
from .word_search_generator import generate_word_search_puzzle


# Holds the next day's set, published ahead of time.
NEXT_DIRNAME = "next"


def get_reference_date(date_val: str | date | None = None) -> str:
    """Return ISO YYYY-MM-DD date string. Default to America/Sao_Paulo (or UTC) today."""
    if date_val is None:
        return reference_date_today()
    if isinstance(date_val, date):
        return date_val.isoformat()
    return parse_daily_date(date_val)


def generate_daily_puzzles(
    connection: sqlite3.Connection,
    reference_date: str | date | None = None,
    base_seed: str = "web-launch-v1",
    timer_seconds: int | None = None,
) -> dict[str, Any]:
    """Deterministically generate the 6 daily puzzles for reference_date."""
    iso_date = get_reference_date(reference_date)
    ref_date = date.fromisoformat(iso_date)

    connection.row_factory = sqlite3.Row

    # 1. Daily quiz: 6 base sessions + 6 daily sessions
    dataset, _ = generate_dataset(connection)
    base_sessions = {
        f"{locale}.{difficulty}": create_session(
            dataset,
            QuizConfig(locale, base_seed, play_mode=difficulty, timer_seconds=timer_seconds),
        )
        for locale in LOCALES
        for difficulty in DIFFICULTIES
    }
    daily_sessions = create_daily_sessions(dataset, iso_date, timer_seconds)
    decade_sessions = create_decade_sessions(dataset, base_seed, timer_seconds)
    all_sessions = {**base_sessions, **daily_sessions, **decade_sessions}
    session_pt_br = daily_sessions["daily.pt-BR.standard"]
    session_en = daily_sessions["daily.en.standard"]

    # 2. Intersection grid. If the catalog cannot fill a 3x3, leave grid
    # unset so publish_daily_puzzles can reuse the previous artifact.
    grid = None
    grid_error = None
    try:
        grid = generate_daily_grid(connection, reference_date=ref_date)
    except ValueError as exc:
        grid_error = str(exc)
        sys.stderr.write(f"Daily grid generation failed; keeping previous artifact: {exc}\n")

    # 3. Connections puzzle
    connections_seed = f"kpop-connections-daily-{iso_date}"
    connections = generate_connections_puzzle(
        connection, seed=connections_seed, reference_date=ref_date
    )

    # 4. Name guess puzzle
    guess_seed = f"kpop-guess-daily-{iso_date}"
    name_guess = generate_name_guess_puzzle(
        connection, seed=guess_seed, reference_date=ref_date
    )

    # 5. Word search puzzle
    ws_seed = f"kpop-word-search-daily-{iso_date}"
    word_search = generate_word_search_puzzle(
        connection, seed=ws_seed, reference_date=ref_date
    )

    # 6. Timeline puzzle
    timeline_seed = f"kpop-timeline-daily-{iso_date}"
    timeline = generate_timeline_puzzle(
        connection, reference_date=ref_date, seed=timeline_seed
    )

    return {
        "reference_date": iso_date,
        "dataset_version": dataset["dataset_version"],
        "sessions": all_sessions,
        "session_pt_br": session_pt_br,
        "session_en": session_en,
        "grid": grid,
        "grid_error": grid_error,
        "connections": connections,
        "name_guess": name_guess,
        "word_search": word_search,
        "timeline": timeline,
    }


def publish_daily_puzzles(
    output_dir: Path,
    puzzles: dict[str, Any],
    dry_run: bool = False,
    previous_grid: Path | None = None,
    prune: bool = False,
) -> dict[str, Any]:
    """Publish generated puzzles to output_dir with atomic writes and schema verification.

    ``previous_grid`` is the grid reused when generation fails; it defaults to
    the one already in output_dir. With ``prune``, files that the new set does
    not contain are removed, so a directory holds exactly one day.
    """
    output_dir = Path(output_dir)
    previous_grid = previous_grid or output_dir / GRID_DAILY_FILENAME

    with tempfile.TemporaryDirectory(prefix="daily_puzzles_stage_") as temp_dir_str:
        staging_dir = Path(temp_dir_str)

        # 1. Publish all games into staging directory
        publish(
            staging_dir,
            puzzles["sessions"],
            grid=puzzles["grid"],
            connections=puzzles["connections"],
            name_guess=puzzles["name_guess"],
            word_search=puzzles["word_search"],
            timeline=puzzles["timeline"],
        )
        if puzzles["grid"] is None:
            if not previous_grid.is_file():
                detail = puzzles.get("grid_error") or "unknown error"
                raise ValueError(
                    "grid generation failed and no previous "
                    f"{GRID_DAILY_FILENAME} exists: {detail}"
                )
            shutil.copyfile(previous_grid, staging_dir / GRID_DAILY_FILENAME)
        write_json_atomic(staging_dir / "session.pt-BR.json", puzzles["session_pt_br"], validate_session)
        write_json_atomic(staging_dir / "session.en.json", puzzles["session_en"], validate_session)

        # 2. Verify all artifacts in staging directory
        verify_artifacts(staging_dir)

        published_grid = (
            puzzles["grid"]
            if puzzles["grid"] is not None
            else json.loads((staging_dir / GRID_DAILY_FILENAME).read_text(encoding="utf-8"))
        )
        # Set only when the previous day's grid was kept.
        grid_reused = (
            None
            if puzzles["grid"] is not None
            else {
                "reference_date": published_grid.get("reference_date"),
                "error": puzzles.get("grid_error") or "unknown error",
            }
        )
        result = {
            "reference_date": puzzles["reference_date"],
            "dataset_version": puzzles["dataset_version"],
            "grid_id": published_grid["grid_id"],
            "grid_reused": grid_reused,
            "connections_id": puzzles["connections"]["puzzle_id"],
            "name_guess_id": puzzles["name_guess"]["puzzle_id"],
            "word_search_id": puzzles["word_search"]["puzzle_id"],
            "timeline_id": puzzles["timeline"]["puzzle_id"],
            "dry_run": dry_run,
            "output_dir": str(output_dir),
            "published_files": [p.name for p in sorted(staging_dir.glob("*.json"))],
        }
        if dry_run:
            return result

        # 3. Atomically copy/replace each file from staging_dir into output_dir
        _install_files(staging_dir, output_dir, prune=prune)

        # 4. Final verification in output_dir
        verify_artifacts(output_dir)
        return result


def _install_files(source_dir: Path, output_dir: Path, prune: bool = False) -> None:
    """Copy every file of source_dir into output_dir, replacing each one atomically."""
    output_dir.mkdir(parents=True, exist_ok=True)
    names = set()
    for source_file in sorted(source_dir.iterdir()):
        if not source_file.is_file():
            continue
        names.add(source_file.name)
        target_path = output_dir / source_file.name
        descriptor, temp_path = tempfile.mkstemp(prefix=f".{source_file.name}.", dir=output_dir)
        try:
            with os.fdopen(descriptor, "wb") as dst, source_file.open("rb") as src:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
            os.replace(temp_path, target_path)
        except BaseException:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
            raise
    if prune:
        for stale in output_dir.iterdir():
            if stale.is_file() and stale.name not in names:
                stale.unlink()

    # Fsync output_dir directory entry
    dir_fd = os.open(output_dir, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def _published_day(directory: Path) -> str | None:
    try:
        payload = json.loads((directory / CONNECTIONS_DAILY_FILENAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("reference_date") if isinstance(payload, dict) else None
    return value if isinstance(value, str) else None


def _published_result(output_dir: Path, reference_date: str, **flags: bool) -> dict[str, Any]:
    def read(name: str) -> dict[str, Any]:
        return json.loads((output_dir / name).read_text(encoding="utf-8"))

    return {
        "reference_date": reference_date,
        "dataset_version": read(MANIFEST_FILENAME)["dataset_version"],
        "grid_id": read(GRID_DAILY_FILENAME)["grid_id"],
        "grid_reused": None,
        "connections_id": read(CONNECTIONS_DAILY_FILENAME)["puzzle_id"],
        "name_guess_id": read(NAME_GUESS_DAILY_FILENAME)["puzzle_id"],
        "word_search_id": read(WORD_SEARCH_DAILY_FILENAME)["puzzle_id"],
        "timeline_id": read(TIMELINE_DAILY_FILENAME)["puzzle_id"],
        "dry_run": False,
        "output_dir": str(output_dir),
        **flags,
    }


def keep_or_promote_day(output_dir: Path, reference_date: str) -> dict[str, Any] | None:
    """Reuse a set already published for reference_date.

    Players may already have played the day, from output_dir or from the copy
    published ahead under ``next/``, so the day keeps those bytes instead of
    being generated again from a newer database. Returns None when neither
    directory holds that day.
    """
    if _published_day(output_dir) == reference_date:
        verify_artifacts(output_dir)
        return _published_result(output_dir, reference_date, already_published=True)
    next_dir = output_dir / NEXT_DIRNAME
    if _published_day(next_dir) != reference_date:
        return None
    verify_artifacts(next_dir)
    _install_files(next_dir, output_dir)
    verify_artifacts(output_dir)
    return _published_result(output_dir, reference_date, promoted_from_next=True)


def run_daily_puzzles(
    database: Path | str = Path("data/kpop.db"),
    output_dir: Path | str = Path("web/public/data"),
    reference_date: str | date | None = None,
    dry_run: bool = False,
    verify_only: bool = False,
    base_seed: str = "web-launch-v1",
    timer_seconds: int | None = None,
    ahead: bool = False,
    regenerate: bool = False,
) -> dict[str, Any]:
    """Orchestrate daily puzzles generation and publication.

    With ``ahead``, the next day's set is also published under ``next/`` so
    the site can switch to it at midnight in Sao Paulo, before the next run.
    A day that is already published is kept unless ``regenerate`` is set.
    """
    output_dir_path = Path(output_dir)

    if verify_only:
        verify_artifacts(output_dir_path)
        next_dir = output_dir_path / NEXT_DIRNAME
        if (next_dir / MANIFEST_FILENAME).is_file():
            verify_artifacts(next_dir)
        return {
            "status": "verified",
            "output_dir": str(output_dir_path),
        }

    db_path = Path(database)
    if not db_path.is_file():
        raise FileNotFoundError(f"Database does not exist: {db_path}")

    iso_date = get_reference_date(reference_date)
    result = None if dry_run or regenerate else keep_or_promote_day(output_dir_path, iso_date)

    try:
        connection = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        connection = sqlite3.connect(str(db_path))

    try:
        if result is None:
            puzzles = generate_daily_puzzles(
                connection,
                reference_date=iso_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
            )
            result = publish_daily_puzzles(output_dir_path, puzzles, dry_run=dry_run)
        if ahead:
            next_date = (date.fromisoformat(iso_date) + timedelta(days=1)).isoformat()
            next_puzzles = generate_daily_puzzles(
                connection,
                reference_date=next_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
            )
            result["next"] = publish_daily_puzzles(
                output_dir_path / NEXT_DIRNAME,
                next_puzzles,
                dry_run=dry_run,
                previous_grid=output_dir_path / GRID_DAILY_FILENAME,
                prune=True,
            )
    finally:
        connection.close()
    return result
