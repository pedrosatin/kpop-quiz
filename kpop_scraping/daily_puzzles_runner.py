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

import os
import shutil
import sqlite3
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .connections_generator import generate_connections_puzzle
from .grid_generator import generate_daily_grid
from .name_guess_generator import generate_name_guess_puzzle
from .quiz_generator import QuizConfig, create_session, generate_dataset
from .quiz_schema import validate_session, write_json_atomic
from .timeline_generator import generate_timeline_puzzle
from .web_publish import (
    DIFFICULTIES,
    LOCALES,
    create_daily_sessions,
    parse_daily_date,
    publish,
    verify_artifacts,
)
from .word_search_generator import generate_word_search_puzzle


def get_reference_date(date_val: str | date | None = None) -> str:
    """Return ISO YYYY-MM-DD date string. Default to America/Sao_Paulo (or UTC) today."""
    if date_val is None:
        try:
            from zoneinfo import ZoneInfo

            return datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
        except Exception:
            return datetime.now(timezone.utc).date().isoformat()
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
    all_sessions = {**base_sessions, **daily_sessions}
    session_pt_br = daily_sessions["daily.pt-BR.standard"]
    session_en = daily_sessions["daily.en.standard"]

    # 2. Intersection grid
    grid = generate_daily_grid(connection, reference_date=ref_date)

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
        "connections": connections,
        "name_guess": name_guess,
        "word_search": word_search,
        "timeline": timeline,
    }


def publish_daily_puzzles(
    output_dir: Path,
    puzzles: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Publish generated puzzles to output_dir with atomic writes and schema verification."""
    output_dir = Path(output_dir)

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
        write_json_atomic(staging_dir / "session.pt-BR.json", puzzles["session_pt_br"], validate_session)
        write_json_atomic(staging_dir / "session.en.json", puzzles["session_en"], validate_session)

        # 2. Verify all artifacts in staging directory
        verify_artifacts(
            staging_dir,
            require_grid=True,
            require_connections=True,
            require_name_guess=True,
            require_word_search=True,
            require_timeline=True,
        )

        if dry_run:
            return {
                "reference_date": puzzles["reference_date"],
                "dataset_version": puzzles["dataset_version"],
                "grid_id": puzzles["grid"]["grid_id"],
                "connections_id": puzzles["connections"]["puzzle_id"],
                "name_guess_id": puzzles["name_guess"]["puzzle_id"],
                "word_search_id": puzzles["word_search"]["puzzle_id"],
                "timeline_id": puzzles["timeline"]["puzzle_id"],
                "dry_run": True,
                "output_dir": str(output_dir),
                "published_files": [p.name for p in sorted(staging_dir.glob("*.json"))],
            }

        # 3. Atomically copy/replace each file from staging_dir into output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        for staged_file in sorted(staging_dir.iterdir()):
            if not staged_file.is_file():
                continue
            target_path = output_dir / staged_file.name
            descriptor, temp_path = tempfile.mkstemp(prefix=f".{staged_file.name}.", dir=output_dir)
            try:
                with os.fdopen(descriptor, "wb") as dst, staged_file.open("rb") as src:
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

        # Fsync output_dir directory entry
        dir_fd = os.open(output_dir, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

        # 4. Final verification in output_dir
        verify_artifacts(
            output_dir,
            require_grid=True,
            require_connections=True,
            require_name_guess=True,
            require_word_search=True,
            require_timeline=True,
        )

        return {
            "reference_date": puzzles["reference_date"],
            "dataset_version": puzzles["dataset_version"],
            "grid_id": puzzles["grid"]["grid_id"],
            "connections_id": puzzles["connections"]["puzzle_id"],
            "name_guess_id": puzzles["name_guess"]["puzzle_id"],
            "word_search_id": puzzles["word_search"]["puzzle_id"],
            "timeline_id": puzzles["timeline"]["puzzle_id"],
            "dry_run": False,
            "output_dir": str(output_dir),
            "published_files": [p.name for p in sorted(staging_dir.glob("*.json"))],
        }


def run_daily_puzzles(
    database: Path | str = Path("data/kpop.db"),
    output_dir: Path | str = Path("web/public/data"),
    reference_date: str | date | None = None,
    dry_run: bool = False,
    verify_only: bool = False,
    base_seed: str = "web-launch-v1",
    timer_seconds: int | None = None,
) -> dict[str, Any]:
    """Orchestrate daily puzzles generation and publication."""
    output_dir_path = Path(output_dir)

    if verify_only:
        verify_artifacts(
            output_dir_path,
            require_grid=True,
            require_connections=True,
            require_name_guess=True,
            require_word_search=True,
            require_timeline=True,
        )
        return {
            "status": "verified",
            "output_dir": str(output_dir_path),
        }

    db_path = Path(database)
    if not db_path.is_file():
        raise FileNotFoundError(f"Database does not exist: {db_path}")

    try:
        connection = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        connection = sqlite3.connect(str(db_path))

    try:
        puzzles = generate_daily_puzzles(
            connection,
            reference_date=reference_date,
            base_seed=base_seed,
            timer_seconds=timer_seconds,
        )
    finally:
        connection.close()

    result = publish_daily_puzzles(
        output_dir_path,
        puzzles,
        dry_run=dry_run,
    )
    return result
