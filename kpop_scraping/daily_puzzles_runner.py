"""Unified daily puzzle generation and publishing runner.

Deterministically generates and atomically publishes the 8 daily K-pop puzzle games:
1. Daily bilingual quiz sessions (and session.pt-BR.json, session.en.json)
2. Intersection grid (grid.daily.json)
3. Connections puzzle (connections.daily.json)
4. Name guess puzzle (name-guess.daily.json)
5. Word search puzzle (word-search.daily.json)
6. Timeline puzzle (timeline.daily.json)
7. Group code pilot (code-groups.daily.json)
8. Crossword (crossword.daily.json, with crossword-publication.<date>.json)

Failure policy (partial publish): each game is generated and validated on
its own, and a failure of any kind (``MemoryError`` included) leaves only
that game out of the day. The other games still publish, the set carries
``daily-set.json`` with the reason for each absent game (see ``daily_set``),
and the runner result records the absence in ``<game>_skipped``. The run
fails only when no game of the reference day could be generated. A failure
of the next day's set, published ahead under ``next/``, never takes the
reference day down with it.

The grid is the one game that may stand in with an earlier artifact: when
generation fails, the previous grid is kept if it still validates. The
group code pilot never reuses a previous day's artifact, because the puzzle
is date-derived and a stale sequence would contradict the day's identity.

The crossword never reuses an earlier board either. It cannot repeat a group
of the day before, so each set also carries a durable record of what its day
published (see ``crossword_publication``), and a day is generated from the
confirmed record of the previous one. A day without that record, a fact base
that cannot be read, or a generator that fails publishes no board: the
record says ``omitted`` and the page tells the player there is no crossword
that day. An exhausted generator still publishes its ``status: omitted``
artifact, so the page knows the day was omitted rather than late.
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
from typing import Any, Callable

from .code_groups_cli import generate as generate_code_groups_puzzle
from .code_groups_cli import validate as validate_code_groups_puzzle
from .connections_generator import (
    generate_connections_puzzle,
    validate_connections_partition_unique,
)
from .connections_schema import validate_connections_puzzle
from .crossword_daily import generate as generate_daily_crossword
from .crossword_daily import validate as validate_daily_crossword
from .crossword_daily import validate_published as validate_published_crossword
from .crossword_daily_repository import read_base as read_crossword_base
from .crossword_publication import (
    confirmed_record as confirmed_crossword_record,
    context_for as crossword_context_for,
    omission_record as crossword_omission_record,
    read_record as read_crossword_record,
    record_from_artifact as crossword_record_from_artifact,
    verify_history as verify_crossword_history,
    write_record as write_crossword_record,
)
from .daily_set import (
    DAILY_SET_FILENAME,
    GAMES,
    daily_set,
    note_omission,
    omission_reason,
    read_daily_set,
    single_line,
    write_daily_set,
)
from .evidence import EVIDENCE_RULES_VERSION
from .grid_generator import generate_daily_grid, grid_incompatibility
from .grid_publication import publication, read_publication, write_publication
from .grid_schema import validate_intersection_grid, write_intersection_grid_atomic
from .name_guess_generator import generate_name_guess_puzzle
from .name_guess_schema import validate_name_guess_puzzle
from .quiz_catalog import (
    build_catalog,
    build_catalog_manifest,
    catalog_coverage_lines,
    publish_catalog,
    remove_catalog,
)
from .quiz_generator import QuizConfig, generate_dataset
from .quiz_session import create_session
from .quiz_schema import validate_session, write_json_atomic
from .quiz_utils import reference_date_today
from .timeline_generator import generate_timeline_puzzle
from .timeline_schema import validate_timeline_puzzle
from .web_publish import (
    CODE_GROUPS_DAILY_FILENAME,
    CONNECTIONS_DAILY_FILENAME,
    CROSSWORD_DAILY_FILENAME,
    DAILY_GAME_FILES,
    DAILY_SET_FILES,
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
    validate_quiz_sessions,
    verify_artifacts,
)
from .word_search_generator import generate_word_search_puzzle_with_fallback
from .word_search_schema import validate_word_search_puzzle


# Holds the next day's set, published ahead of time.
NEXT_DIRNAME = "next"
# The checksum of every crossword artifact already covers its date.
CROSSWORD_SEED = "kpop-crossword-daily"
MISSING_CROSSWORD_HISTORY = "missing previous-day crossword history"


def evidence_rules_versions(connection: sqlite3.Connection) -> dict[str, str | None]:
    """Return the evidence rules version of the code and of the database's facts.

    The database's version is the one the last completed fact run recorded.
    It is ``None`` when that run predates the record (migration 11), when the
    database has no completed fact run, and when it predates the column.
    The cron opens the database read-only and never migrates it, and the
    database it restores from the cache may be that old.
    """
    try:
        row = connection.execute(
            """
            SELECT evidence_rules_version FROM fact_runs
            WHERE status = 'completed'
            ORDER BY completed_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    except sqlite3.OperationalError as exc:
        if "no such" not in str(exc):
            raise
        row = None
    return {"code": EVIDENCE_RULES_VERSION, "database": row[0] if row else None}


def get_reference_date(date_val: str | date | None = None) -> str:
    """Return ISO YYYY-MM-DD date string. Default to today in America/Sao_Paulo."""
    if date_val is None:
        return reference_date_today()
    if isinstance(date_val, date):
        return date_val.isoformat()
    return parse_daily_date(date_val)


def _quiz_sessions(
    dataset: dict[str, Any], iso_date: str, base_seed: str, timer_seconds: int | None
) -> dict[str, dict[str, Any]]:
    """Base, daily and decade sessions of one dataset."""
    base_sessions = {
        f"{locale}.{difficulty}": create_session(
            dataset,
            QuizConfig(locale, base_seed, play_mode=difficulty, timer_seconds=timer_seconds),
        )
        for locale in LOCALES
        for difficulty in DIFFICULTIES
    }
    return {
        **base_sessions,
        **create_daily_sessions(dataset, iso_date, timer_seconds),
        **create_decade_sessions(dataset, base_seed, timer_seconds),
    }


def _generate_quiz(
    connection: sqlite3.Connection,
    iso_date: str,
    base_seed: str,
    timer_seconds: int | None,
    related_clues: bool,
) -> dict[str, Any]:
    """Datasets and sessions of the quiz, checked as ``publish`` will check them."""
    dataset, _ = generate_dataset(connection)
    sessions = _quiz_sessions(dataset, iso_date, base_seed, timer_seconds)
    enriched_dataset = enriched_sessions = None
    if related_clues:
        enriched_dataset, _ = generate_dataset(connection, related_clues=True)
        enriched_sessions = _quiz_sessions(enriched_dataset, iso_date, base_seed, timer_seconds)
    validate_quiz_sessions(sessions, enriched_sessions)
    return {
        "dataset": dataset,
        "enriched_dataset": enriched_dataset,
        "sessions": sessions,
        "enriched_sessions": enriched_sessions,
    }


def _isolated(
    game: str, iso_date: str, produce: Callable[[], Any]
) -> tuple[Any, str | None]:
    """Run one game's generator; return (artifact, None) or (None, reason).

    Any ``Exception`` leaves only this game out of the day, and
    ``MemoryError`` and ``RecursionError`` are ``Exception`` subclasses.
    ``KeyboardInterrupt`` and ``SystemExit`` are not: they cancel the run,
    and catching them would publish a partial day nobody asked for.
    """
    try:
        return produce(), None
    except Exception as exc:
        reason = omission_reason(exc)
        sys.stderr.write(f"Daily {game} not generated for {iso_date}: {reason}\n")
        return None, reason


def _checked(artifact: dict[str, Any], validate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Validate an artifact inside its game's isolation, so a bad one is omitted alone."""
    validate(artifact)
    return artifact


def generate_daily_puzzles(
    connection: sqlite3.Connection,
    reference_date: str | date | None = None,
    base_seed: str = "web-launch-v1",
    timer_seconds: int | None = None,
    related_clues: bool = False,
    crossword_previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Deterministically generate the 8 daily puzzles for reference_date.

    The quiz sessions always come out without related decade clues: those are
    the ones the v2 manifest lists, and a client released before the clues
    existed rejects a session that carries one. With ``related_clues`` the
    result also carries ``enriched_sessions``, the same sessions with the
    clues added, which are published under ``manifest-v3.json``.

    Each game is generated and validated on its own (see ``_isolated``).
    A game that fails comes back as None, and ``omitted`` maps its name
    (``daily_set.GAMES``) to the reason; the day publishes without it
    (partial publish policy, see the module docstring). The crossword is
    generated from ``crossword_previous``, the history context of the
    confirmed day before; None means that history is missing, and the day
    omits its crossword. The returned ``crossword_record`` always says what
    the day publishes.
    """
    iso_date = get_reference_date(reference_date)
    ref_date = date.fromisoformat(iso_date)

    connection.row_factory = sqlite3.Row
    omitted: dict[str, str] = {}

    def generate(game: str, produce: Callable[[], Any]) -> Any:
        artifact, reason = _isolated(game, iso_date, produce)
        if reason is not None:
            omitted[game] = reason
        return artifact

    # 1. Daily quiz: base, daily and decade sessions, in both languages.
    quiz = generate(
        "quiz",
        lambda: _generate_quiz(connection, iso_date, base_seed, timer_seconds, related_clues),
    ) or {}

    # 2. Intersection grid. When it fails, publish_daily_puzzles reuses the
    # previous artifact if it is still valid, or publishes the day without one.
    grid = generate(
        "grid",
        lambda: _checked(generate_daily_grid(connection, reference_date=ref_date), validate_intersection_grid),
    )

    # 3. Connections puzzle
    connections = generate("connections", lambda: _checked(
        generate_connections_puzzle(
            connection, seed=f"kpop-connections-daily-{iso_date}", reference_date=ref_date
        ),
        validate_connections_puzzle,
    ))

    # 4. Name guess puzzle
    name_guess = generate("name-guess", lambda: _checked(
        generate_name_guess_puzzle(
            connection, seed=f"kpop-guess-daily-{iso_date}", reference_date=ref_date
        ),
        validate_name_guess_puzzle,
    ))

    # 5. Word search puzzle, with the theme it fell back to, if any.
    word_search, word_search_fallback = generate("word-search", lambda: _word_search(
        connection, iso_date, ref_date
    )) or (None, None)

    # 6. Timeline puzzle
    timeline = generate("timeline", lambda: _checked(
        generate_timeline_puzzle(
            connection, reference_date=ref_date, seed=f"kpop-timeline-daily-{iso_date}"
        ),
        validate_timeline_puzzle,
    ))

    # 7. Group code pilot. Never replaced by an earlier day's sequence.
    code_groups = generate("code-groups", lambda: _checked(
        generate_code_groups_puzzle(
            connection, seed=f"kpop-code-groups-daily-{iso_date}", reference_date=ref_date
        ),
        validate_code_groups_puzzle,
    ))

    # 8. Crossword. Never an earlier board; its record says why it is absent.
    crossword, crossword_record = _generate_crossword(connection, iso_date, crossword_previous)

    sessions = quiz.get("sessions")
    return {
        "reference_date": iso_date,
        "dataset_version": quiz["dataset"]["dataset_version"] if quiz else None,
        "sessions": sessions,
        "enriched_sessions": quiz.get("enriched_sessions"),
        # Kept for the question catalog, so one run generates each dataset once.
        "dataset": quiz.get("dataset"),
        "enriched_dataset": quiz.get("enriched_dataset"),
        "session_pt_br": sessions["daily.pt-BR.standard"] if sessions else None,
        "session_en": sessions["daily.en.standard"] if sessions else None,
        "grid": grid,
        "connections": connections,
        "name_guess": name_guess,
        "word_search": word_search,
        "word_search_fallback": (
            word_search_fallback._asdict() if word_search_fallback is not None else None
        ),
        "timeline": timeline,
        "code_groups": code_groups,
        "crossword": crossword,
        "crossword_record": crossword_record,
        "omitted": omitted,
    }


def _word_search(
    connection: sqlite3.Connection, iso_date: str, ref_date: date
) -> tuple[dict[str, Any], Any]:
    word_search, fallback = generate_word_search_puzzle_with_fallback(
        connection, seed=f"kpop-word-search-daily-{iso_date}", reference_date=ref_date
    )
    validate_word_search_puzzle(word_search)
    if fallback is not None:
        sys.stderr.write(
            f"Word search theme {fallback.requested_theme_id} could not be "
            f"placed for {iso_date}; published theme {fallback.used_theme_id} "
            f"(tried and abandoned: {', '.join(fallback.failed_theme_ids)})\n"
        )
    return word_search, fallback


def _generate_crossword(
    connection: sqlite3.Connection, iso_date: str, previous: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Crossword artifact of the day (None when there is none) and its record.

    The artifact is validated against the same fact base before it is
    returned, including the previous-day exclusion, so the publisher never
    writes a board the generator could not prove.
    """
    if previous is None:
        sys.stderr.write(
            f"Daily crossword not generated for {iso_date}: {MISSING_CROSSWORD_HISTORY}\n"
        )
        return None, crossword_omission_record(iso_date, MISSING_CROSSWORD_HISTORY)
    try:
        base = read_crossword_base(connection)
        artifact = generate_daily_crossword(base, iso_date, CROSSWORD_SEED, previous)
        validate_daily_crossword(artifact, base)
        if artifact["previous"] != previous:
            raise ValueError("crossword history differs from the confirmed previous day")
    except Exception as exc:
        # Same isolation as every other game (see _isolated).
        reason = omission_reason(exc)
        sys.stderr.write(f"Daily crossword generation failed for {iso_date}: {reason}\n")
        return None, crossword_omission_record(iso_date, f"generation failed: {reason}")
    return artifact, crossword_record_from_artifact(artifact)


class NoGamePublishedError(ValueError):
    """Every game of a day failed; there is no set to publish."""


# Result key of each game that may be omitted on its own, besides the grid,
# the group code pilot and the crossword, which have their own records.
SKIPPED_KEYS = {
    "quiz": "quiz_skipped",
    "connections": "connections_skipped",
    "name-guess": "name_guess_skipped",
    "word-search": "word_search_skipped",
    "timeline": "timeline_skipped",
}


def publish_daily_puzzles(
    output_dir: Path,
    puzzles: dict[str, Any],
    dry_run: bool = False,
    previous_grid: Path | None = None,
    prune: bool = False,
    connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Publish generated puzzles to output_dir with atomic writes and schema verification.

    Partial publish policy: a game ``generate_daily_puzzles`` could not
    produce is left out of the set, its file is removed from output_dir, and
    ``daily-set.json`` records why (see ``daily_set``). The result says so in
    ``<game>_skipped``. Raises ``NoGamePublishedError`` before writing
    anything when no game was generated for the day.

    ``previous_grid`` is the grid reused when generation fails, as long as its
    content still passes validation; it defaults to the one already in
    output_dir. When it is missing or invalid, the day publishes without
    ``grid.daily.json`` and the result records why in ``grid_skipped``.
    With ``connection``, the previous grid must also still satisfy the
    current eligibility policy for its answers, not only the schema.
    The group code pilot never reuses an earlier artifact: the day publishes
    without ``code-groups.daily.json`` and ``code_groups_skipped`` says why.
    With ``prune``, game files outside the new set are removed. Publication
    history remains available to reject cached artifacts from earlier days.
    """
    output_dir = Path(output_dir)
    if not dry_run:
        _guard_publication_date(output_dir, puzzles["reference_date"])
    previous_grid = previous_grid or output_dir / GRID_DAILY_FILENAME
    errors = puzzles.get("omitted", {})
    crossword = puzzles.get("crossword")
    generated = [
        puzzles["sessions"], puzzles["grid"], puzzles["connections"], puzzles["name_guess"],
        puzzles["word_search"], puzzles["timeline"], puzzles["code_groups"],
        crossword if crossword is not None and crossword["status"] == "ready" else None,
    ]
    if all(artifact is None for artifact in generated):
        raise NoGamePublishedError(
            f"No game could be generated for {puzzles['reference_date']}: "
            + "; ".join(f"{game}: {reason}" for game, reason in errors.items())
        )

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
            code_groups=puzzles["code_groups"],
            enriched_sessions=puzzles.get("enriched_sessions"),
            crossword=crossword,
        )
        crossword_record = puzzles.get("crossword_record")
        if crossword_record is not None:
            write_crossword_record(staging_dir, crossword_record)
        grid_skipped = None
        if puzzles["grid"] is None:
            previous_invalid = _invalid_grid_reason(previous_grid, connection)
            if previous_invalid is None and previous_grid.is_file():
                shutil.copyfile(previous_grid, staging_dir / GRID_DAILY_FILENAME)
            else:
                # No grid to publish; the grid page reports the artifact
                # as missing for this day.
                grid_skipped = {
                    "error": errors.get("grid") or "unknown error",
                    "previous_invalid": previous_invalid,
                }
        if puzzles["sessions"] is not None:
            write_json_atomic(staging_dir / "session.pt-BR.json", puzzles["session_pt_br"], validate_session)
            write_json_atomic(staging_dir / "session.en.json", puzzles["session_en"], validate_session)

        code_groups_skipped = (
            {"error": errors.get("code-groups") or "unknown error"}
            if puzzles["code_groups"] is None
            else None
        )
        write_daily_set(staging_dir, daily_set(
            puzzles["reference_date"], _omitted_games(staging_dir, errors, crossword_record),
        ))

        # 2. Verify all artifacts in staging directory. Every game is
        # optional, as long as daily-set.json explains its absence; when a
        # file is present, verify() validates it.
        verify_artifacts(staging_dir, require_grid=False, require_code_groups=False)

        published_grid = puzzles["grid"]
        grid_reused = None
        if published_grid is None and grid_skipped is None:
            published_grid = json.loads((staging_dir / GRID_DAILY_FILENAME).read_text(encoding="utf-8"))
            # Set only when the previous day's grid was kept.
            grid_reused = {
                "reference_date": published_grid.get("reference_date"),
                "error": errors.get("grid") or "unknown error",
            }
        day = puzzles["reference_date"]
        previous_publication = read_publication(output_dir, day)
        rejected_id = None
        if previous_grid.is_file() and _invalid_grid_reason(previous_grid, connection):
            try:
                old = json.loads(previous_grid.read_text(encoding="utf-8"))
                validate_intersection_grid(old)
            except (OSError, ValueError):
                old = None
            if old is not None:
                if not dry_run:
                    _reject_grid_origin(previous_grid.parent, old)
                if old["reference_date"] == day:
                    rejected_id = old["grid_id"]
                    previous_publication = read_publication(output_dir, day)
        write_publication(staging_dir, publication(day, published_grid, previous_publication, rejected_id))
        result = {
            "reference_date": puzzles["reference_date"],
            "dataset_version": puzzles["dataset_version"],
            "grid_id": published_grid["grid_id"] if published_grid is not None else None,
            "grid_reused": grid_reused,
            "grid_skipped": grid_skipped,
            "connections_id": _board_id(puzzles["connections"]),
            "name_guess_id": _board_id(puzzles["name_guess"]),
            "word_search_id": _board_id(puzzles["word_search"]),
            "word_search_fallback": puzzles.get("word_search_fallback"),
            "timeline_id": _board_id(puzzles["timeline"]),
            "code_groups_id": _board_id(puzzles["code_groups"]),
            "code_groups_skipped": code_groups_skipped,
            **{
                key: {"error": errors[game]} if game in errors else None
                for game, key in SKIPPED_KEYS.items()
            },
            **_crossword_result(crossword, crossword_record),
            "related_clues": puzzles.get("enriched_sessions") is not None,
            "dry_run": dry_run,
            "output_dir": str(output_dir),
            "published_files": [p.name for p in sorted(staging_dir.glob("*.json"))],
        }
        if dry_run:
            return result

        # 3. Atomically install the set. A game the set omits loses the file
        # an earlier day left in output_dir (see _install_files).
        _install_files(staging_dir, output_dir, prune=prune)

        # 4. Final verification in output_dir.
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
        return result


def _board_id(artifact: dict[str, Any] | None) -> str | None:
    return artifact["puzzle_id"] if artifact is not None else None


def _omitted_games(
    staging_dir: Path, errors: dict[str, str], crossword_record: dict[str, Any] | None
) -> dict[str, str]:
    """Reason of each game the staged set has no file for.

    A grid kept from the previous day is published, so it is not omitted.
    """
    omitted = {}
    for game in GAMES:
        if (staging_dir / DAILY_GAME_FILES[game]).is_file():
            continue
        reason = errors.get(game)
        if game == "crossword" and crossword_record is not None:
            reason = crossword_record["reason"]
        omitted[game] = single_line(reason or "not generated")
    return omitted


def declared_board_swaps(result: dict[str, Any]) -> list[dict[str, str]]:
    """Boards of the day that a kept or promoted run replaced on purpose.

    The board swap gate (``board_swap_gate``) accepts these and refuses any
    other change to a date already published.
    """
    day = result["reference_date"]
    swaps = []
    grid = result.get("grid_revalidated")
    if grid:
        swaps.append({
            "game": "grid", "date": day,
            "reason": f"grid {grid['previous_grid_id']} {grid['action']}: {grid['reason']}",
        })
    crossword = result.get("crossword_confirmed")
    if crossword and crossword["action"] != "recorded":
        swaps.append({
            "game": "crossword", "date": day,
            "reason": (
                f"crossword {crossword['previous_dataset_version']} {crossword['action']}: "
                f"{crossword['reason']}"
            ),
        })
    return swaps


def _crossword_result(
    artifact: dict[str, Any] | None, record: dict[str, Any] | None
) -> dict[str, Any]:
    """Crossword fields of a runner result; ``crossword_record`` feeds the next day."""
    ready = artifact is not None and artifact["status"] == "ready"
    return {
        "crossword_id": artifact["dataset_version"] if ready else None,
        # A pilot record has no reason: its set predates the daily crossword.
        "crossword_skipped": (
            None
            if ready or record is None
            else {
                "reason": record["reason"] or "set published before the daily crossword",
                "state": record["state"],
            }
        ),
        "crossword_record": record,
    }


def _invalid_grid_reason(grid_path: Path, connection: sqlite3.Connection | None = None) -> str | None:
    """Return why the grid at grid_path fails validation, or None when valid or absent.

    With ``connection``, the answers must also pass the current eligibility
    policy, which a schema check cannot tell.
    """
    if not grid_path.is_file():
        return None
    try:
        grid = json.loads(grid_path.read_text(encoding="utf-8"))
        validate_intersection_grid(grid)
    except (OSError, ValueError) as exc:
        return str(exc)
    return grid_incompatibility(connection, grid) if connection is not None else None


def _reject_grid_origin(directory: Path, grid: dict) -> None:
    """Persist rejection at the artifact's date before any replacement/removal."""
    day = grid["reference_date"]
    previous = read_publication(directory, day)
    # Rejecting an older version must preserve a newer authorized replacement.
    accepted = None
    if previous and previous["grid_id"] not in (None, grid["grid_id"]):
        accepted = dict(grid_id=previous["grid_id"], reference_date=previous["grid_reference_date"])
    write_publication(directory, publication(day, accepted, previous, grid["grid_id"]))


def _install_publication(source: Path, directory: Path) -> None:
    day = source.name.removeprefix("grid-publication.").removesuffix(".json")
    try:
        incoming = read_publication(source.parent, day)
        previous = read_publication(directory, day)
    except ValueError:
        # Keep malformed historical records closed to the loader, without
        # blocking publication of an unrelated day or overwriting its ledger.
        return
    # Promotion of an older next set cannot resurrect an already rejected hash.
    if previous and incoming["grid_id"] in previous["replaces"]:
        incoming = {**previous, "replaces": sorted(set(previous["replaces"] + incoming["replaces"]))}
    elif previous:
        incoming["replaces"] = sorted(set(previous["replaces"] + incoming["replaces"]))
    write_publication(directory, incoming)


def _revalidate_published_grid(
    output_dir: Path, reference_date: str, connection: sqlite3.Connection
) -> dict[str, Any] | None:
    """Replace a kept or promoted grid that the current policy no longer admits.

    The day's other artifacts keep their bytes. The grid is generated again
    for the same date, which derives a new ``grid_id`` from its content; when
    that fails too, the day goes without a grid, as for any failed generation.
    Returns None when there was nothing to replace.
    """
    grid_path = output_dir / GRID_DAILY_FILENAME
    reason = _invalid_grid_reason(grid_path, connection)
    if reason is None:
        return None
    previous_grid_id = None
    try:
        old = json.loads(grid_path.read_text(encoding="utf-8"))
        validate_intersection_grid(old)
    except (OSError, ValueError):
        old = None
    if old is not None:
        _reject_grid_origin(output_dir, old)
        previous_grid_id = old["grid_id"]
    previous_publication = read_publication(output_dir, reference_date)
    # Reject malformed identities instead of publishing them as replacement history.
    if not isinstance(previous_grid_id, str) or len(previous_grid_id) != 64:
        previous_grid_id = None
    tombstone = publication(reference_date, None, previous_publication, previous_grid_id)
    write_publication(output_dir, tombstone)
    outcome = {"reason": reason, "previous_grid_id": previous_grid_id}
    try:
        grid = generate_daily_grid(connection, reference_date=reference_date)
        validate_intersection_grid(grid)
    except Exception as exc:
        # Same isolation as a generated day (see _isolated).
        reason = omission_reason(exc)
        grid_path.unlink()
        note_omission(output_dir, "grid", f"published grid no longer eligible: {reason}")
        return {**outcome, "action": "removed", "error": reason}
    write_intersection_grid_atomic(grid_path, grid)
    write_publication(output_dir, publication(reference_date, grid, tombstone))
    return {**outcome, "action": "regenerated", "grid_id": grid["grid_id"]}


def _recover_installation(output_dir: Path) -> None:
    backup = output_dir.with_name(f".{output_dir.name}.publication-backup")
    if not backup.exists():
        return
    if not output_dir.exists():
        os.replace(backup, output_dir)
    else:
        shutil.rmtree(backup)


def _install_files(source_dir: Path, output_dir: Path, prune: bool = False) -> None:
    """Install a complete directory snapshot; recover an interrupted swap on retry."""
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    _recover_installation(output_dir)
    _recover_installation(output_dir / NEXT_DIRNAME)
    backup = output_dir.with_name(f".{output_dir.name}.publication-backup")
    with tempfile.TemporaryDirectory(
        prefix=f".{output_dir.name}.publication-stage-", dir=output_dir.parent,
    ) as folder:
        snapshot = Path(folder) / "snapshot"
        if output_dir.is_dir():
            shutil.copytree(output_dir, snapshot, ignore=shutil.ignore_patterns(
                ".*.publication-stage-*", ".*.publication-backup",
            ))
        else:
            snapshot.mkdir()
        _copy_files(source_dir, snapshot, prune)
        # A set that omits a game, or predates daily-set.json, must not keep
        # the file an earlier day left for it.
        for optional in DAILY_SET_FILES:
            if not (source_dir / optional).is_file():
                (snapshot / optional).unlink(missing_ok=True)
        try:
            if output_dir.exists():
                os.replace(output_dir, backup)
            os.replace(snapshot, output_dir)
        except BaseException:
            _recover_installation(output_dir)
            raise
        _recover_installation(output_dir)


def _copy_files(source_dir: Path, output_dir: Path, prune: bool = False) -> None:
    """Copy every file of source_dir into output_dir, replacing each one atomically."""
    output_dir.mkdir(parents=True, exist_ok=True)
    names = set()
    for source_file in sorted(source_dir.iterdir()):
        if not source_file.is_file():
            continue
        names.add(source_file.name)
        if source_file.name.startswith("grid-publication.") and (output_dir / source_file.name).is_file():
            _install_publication(source_file, output_dir)
            continue
        if source_file.name.startswith("crossword-publication."):
            write_crossword_record(output_dir, json.loads(source_file.read_text(encoding="utf-8")))
            continue
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
            if stale.is_file() and stale.name not in names and not stale.name.startswith(("grid-publication.", "crossword-publication.", "crossword-history.")):
                stale.unlink()

    # Fsync output_dir directory entry
    dir_fd = os.open(output_dir, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def _published_day(directory: Path) -> str | None:
    """Date of the set in ``directory``, from daily-set.json.

    A set published before that record is dated by its connections board,
    which every such set carries. A set that omits a game keeps its date,
    so it is never taken for a day not published yet.
    """
    _recover_installation(directory)
    if (directory / DAILY_SET_FILENAME).is_file():
        return read_daily_set(directory)["reference_date"]
    try:
        payload = json.loads((directory / CONNECTIONS_DAILY_FILENAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("reference_date") if isinstance(payload, dict) else None
    return value if isinstance(value, str) else None


def _guard_publication_date(output_dir: Path, reference_date: str) -> None:
    published = _published_day(output_dir)
    if published is not None and date.fromisoformat(published) > date.fromisoformat(reference_date):
        raise ValueError(f"Cannot publish {reference_date} over newer published day {published}")


def _published_result(output_dir: Path, reference_date: str, **flags: Any) -> dict[str, Any]:
    def read(name: str) -> dict[str, Any] | None:
        path = output_dir / name
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    # Kept or promoted bytes carry no generation error. The skip records
    # mark the artifact as absent for that day, with the reason daily-set.json
    # kept when the set has one.
    day_set = read_daily_set(output_dir)
    reasons = day_set["omitted"] if day_set is not None else {}
    grid = read(GRID_DAILY_FILENAME)
    grid_skipped = (
        {"error": None, "previous_invalid": None, "published_without_grid": True}
        if grid is None
        else None
    )
    # The group code artifact is optional in a published set; sets published
    # before the daily integration, and days published under the partial
    # publish policy, have no file to read.
    code_groups = read(CODE_GROUPS_DAILY_FILENAME)
    manifest = read(MANIFEST_FILENAME)
    skipped = {
        key: (
            {"error": reasons.get(game), "published_without": True}
            if read(DAILY_GAME_FILES[game]) is None
            else None
        )
        for game, key in SKIPPED_KEYS.items()
    }
    return {
        "reference_date": reference_date,
        "dataset_version": manifest["dataset_version"] if manifest is not None else None,
        "grid_id": grid["grid_id"] if grid is not None else None,
        "grid_reused": None,
        "grid_skipped": grid_skipped,
        "connections_id": _board_id(read(CONNECTIONS_DAILY_FILENAME)),
        "name_guess_id": _board_id(read(NAME_GUESS_DAILY_FILENAME)),
        "word_search_id": _board_id(read(WORD_SEARCH_DAILY_FILENAME)),
        "timeline_id": _board_id(read(TIMELINE_DAILY_FILENAME)),
        "code_groups_id": _board_id(code_groups),
        "code_groups_skipped": (
            {"published_without_code_groups": True} if code_groups is None else None
        ),
        **skipped,
        **_crossword_result(read(CROSSWORD_DAILY_FILENAME), read_crossword_record(output_dir, reference_date)),
        "dry_run": False,
        "output_dir": str(output_dir),
        **flags,
    }


def _check_connections_partition(
    directory: Path, connection: sqlite3.Connection | None
) -> dict[str, Any]:
    """Confirm the kept or promoted connections board still has one solution.

    The check needs the database: the file alone cannot show a second partition
    among the criteria's other members. Without it the check is recorded as not
    run. An ambiguous board raises, so it is neither kept nor
    promoted; ``--regenerate`` publishes a new one.
    """
    if not (directory / CONNECTIONS_DAILY_FILENAME).is_file():
        # The set omits the connections board; there is nothing to check.
        return {"checked": False, "reason": "no connections board"}
    if connection is None:
        sys.stderr.write(
            "WARNING: connections partition uniqueness not checked: no database given\n"
        )
        return {"checked": False, "reason": "no database"}
    puzzle = json.loads((directory / CONNECTIONS_DAILY_FILENAME).read_text(encoding="utf-8"))
    try:
        validate_connections_partition_unique(connection, puzzle)
    except ValueError as exc:
        raise ValueError(f"{exc}; publish a new board with --regenerate") from exc
    return {"checked": True, "reason": None}


def keep_or_promote_day(
    output_dir: Path,
    reference_date: str,
    connection: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Reuse a set already published for reference_date.

    Players may already have played the day, from output_dir or from the copy
    published ahead under ``next/``, so the day keeps those bytes instead of
    being generated again from a newer database. Returns None when neither
    directory holds that day.

    With ``connection``, a grid the current eligibility policy no longer
    admits is replaced before the day is reported (see
    ``_revalidate_published_grid``); the other artifacts keep their bytes.
    The connections board is also checked against the database for a single
    solution (see ``_check_connections_partition``); the result reports it in
    ``connections_partition``.
    """
    # A published set may omit any game that daily-set.json lists; verify()
    # still validates every file that is present.
    if _published_day(output_dir) == reference_date:
        read_publication(output_dir, reference_date)
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
        partition = _check_connections_partition(output_dir, connection)
        revalidated = _revalidate_published_grid(output_dir, reference_date, connection) if connection else None
        crossword = _confirm_crossword_day(output_dir, reference_date, connection)
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
        return _published_result(
            output_dir, reference_date, grid_revalidated=revalidated,
            crossword_confirmed=crossword, connections_partition=partition,
            already_published=True,
        )
    _guard_publication_date(output_dir, reference_date)
    next_dir = output_dir / NEXT_DIRNAME
    if _published_day(next_dir) != reference_date:
        return None
    read_publication(next_dir, reference_date)
    verify_artifacts(next_dir, require_grid=False, require_code_groups=False)
    partition = _check_connections_partition(next_dir, connection)
    # A game the promoted set omits loses the file an earlier day left in
    # output_dir (see _install_files).
    _install_files(next_dir, output_dir)
    crossword = _confirm_crossword_day(output_dir, reference_date, connection)
    if crossword is not None and crossword["action"] != "recorded":
        _copy_crossword_day(output_dir, next_dir, reference_date)
    revalidated = _revalidate_published_grid(output_dir, reference_date, connection) if connection else None
    if revalidated is not None:
        current = output_dir / GRID_DAILY_FILENAME
        if current.is_file():
            write_intersection_grid_atomic(
                next_dir / GRID_DAILY_FILENAME, json.loads(current.read_text(encoding="utf-8"))
            )
        else:
            (next_dir / GRID_DAILY_FILENAME).unlink(missing_ok=True)
        write_publication(next_dir, read_publication(output_dir, reference_date))
        _copy_daily_set(output_dir, next_dir)
    verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
    return _published_result(
        output_dir, reference_date, grid_revalidated=revalidated,
        crossword_confirmed=crossword, connections_partition=partition,
        promoted_from_next=True,
    )


def _confirm_crossword_day(
    output_dir: Path, reference_date: str, connection: sqlite3.Connection | None
) -> dict[str, Any] | None:
    """Make the crossword record of a kept or promoted day confirmed and consistent.

    A set published before the daily integration has no record; it gets one
    from what it publishes (the audited pilot board, before any record exists).
    A daily board generated ahead from a history that no longer matches the
    confirmed record of the day before (that day was published again) is
    generated again from the confirmed history, or omitted when it cannot be.
    Returns None when nothing changed.
    """
    record = read_crossword_record(output_dir, reference_date)
    if record is None:
        record = confirmed_crossword_record(output_dir, reference_date) or crossword_omission_record(
            reference_date, "published set carries no crossword record"
        )
        write_crossword_record(output_dir, record)
        return {"action": "recorded", "state": record["state"], "source": record["source"]}
    if record["source"] != "daily" or connection is None:
        return None
    previous_day = (date.fromisoformat(reference_date) - timedelta(days=1)).isoformat()
    expected = crossword_context_for(
        reference_date, confirmed_crossword_record(output_dir, previous_day)
    )
    if expected == record["previous"]:
        return None
    artifact, replacement = _generate_crossword(connection, reference_date, expected)
    if artifact is None:
        (output_dir / CROSSWORD_DAILY_FILENAME).unlink(missing_ok=True)
        note_omission(output_dir, "crossword", replacement["reason"])
    else:
        # _generate_crossword already validated it against the fact base.
        write_json_atomic(output_dir / CROSSWORD_DAILY_FILENAME, artifact, validate_published_crossword)
        note_omission(output_dir, "crossword", None)
    write_crossword_record(output_dir, replacement)
    return {
        "action": "regenerated" if artifact is not None and artifact["status"] == "ready" else "omitted",
        "previous_dataset_version": record["dataset_version"],
        "reason": replacement["reason"],
    }


def _copy_crossword_day(source: Path, target: Path, reference_date: str) -> None:
    """Keep next/ in step with a promoted day whose crossword was replaced."""
    artifact = source / CROSSWORD_DAILY_FILENAME
    if artifact.is_file():
        write_json_atomic(
            target / CROSSWORD_DAILY_FILENAME,
            json.loads(artifact.read_text(encoding="utf-8")),
            validate_published_crossword,
        )
    else:
        (target / CROSSWORD_DAILY_FILENAME).unlink(missing_ok=True)
    write_crossword_record(target, read_crossword_record(source, reference_date))
    _copy_daily_set(source, target)


def _copy_daily_set(source: Path, target: Path) -> None:
    """Keep next/ in step with a promoted day whose record changed."""
    value = read_daily_set(source)
    if value is not None:
        write_daily_set(target, value)


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
    related_clues: bool = False,
    catalog: bool = False,
) -> dict[str, Any]:
    """Orchestrate daily puzzles generation and publication.

    With ``ahead``, the next day's set is also published under ``next/`` so
    the site can switch to it at midnight in Sao Paulo, before the next run.
    A day that is already published is kept unless ``regenerate`` is set.

    A game that fails is left out of its day, which still publishes (see
    ``publish_daily_puzzles``). The run raises ``NoGamePublishedError`` only
    when no game of the reference day could be generated. When that happens
    to the next day, the reference day stays installed and the result says
    so in ``next_skipped``.

    With ``catalog``, the run also publishes the question catalog built from
    the dataset of this run, whether or not the day was kept; it lives in
    ``output_dir`` only, never in ``next/``. Without it a catalog left by an
    earlier run is withdrawn, which is how the flag is turned off again.
    """
    output_dir_path = Path(output_dir)

    if verify_only:
        # The grid and the group code artifact are optional in a published
        # day; a present file of either still validates.
        verify_artifacts(output_dir_path, require_grid=False, require_code_groups=False)
        next_dir = output_dir_path / NEXT_DIRNAME
        if (next_dir / MANIFEST_FILENAME).is_file() or (next_dir / DAILY_SET_FILENAME).is_file():
            verify_artifacts(next_dir, require_grid=False, require_code_groups=False)
        verify_crossword_history(output_dir_path, next_dir)
        return {
            "status": "verified",
            "output_dir": str(output_dir_path),
        }

    db_path = Path(database)
    if not db_path.is_file():
        raise FileNotFoundError(f"Database does not exist: {db_path}")

    iso_date = get_reference_date(reference_date)
    if not dry_run:
        _guard_publication_date(output_dir_path, iso_date)

    try:
        connection = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        connection = sqlite3.connect(str(db_path))

    puzzles = next_puzzles = None
    try:
        result = None if dry_run or regenerate else keep_or_promote_day(output_dir_path, iso_date, connection)
        if result is None:
            previous_day = (date.fromisoformat(iso_date) - timedelta(days=1)).isoformat()
            puzzles = generate_daily_puzzles(
                connection,
                reference_date=iso_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
                related_clues=related_clues,
                crossword_previous=crossword_context_for(
                    iso_date, confirmed_crossword_record(output_dir_path, previous_day)
                ),
            )
            result = publish_daily_puzzles(output_dir_path, puzzles, dry_run=dry_run, connection=connection)
        result["board_swaps"] = declared_board_swaps(result)
        result["evidence_rules"] = evidence_rules_versions(connection)
        if ahead:
            next_date = (date.fromisoformat(iso_date) + timedelta(days=1)).isoformat()
            # The day just published or kept is the history of the next one,
            # also in a dry run, where nothing reached the main directory.
            next_puzzles = generate_daily_puzzles(
                connection,
                reference_date=next_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
                related_clues=related_clues,
                crossword_previous=crossword_context_for(next_date, result["crossword_record"]),
            )
            try:
                result["next"] = publish_daily_puzzles(
                    output_dir_path / NEXT_DIRNAME,
                    next_puzzles,
                    dry_run=dry_run,
                    previous_grid=output_dir_path / GRID_DAILY_FILENAME,
                    prune=True,
                    connection=connection,
                )
            except NoGamePublishedError as exc:
                # The day already installed in output_dir stands. next/ keeps
                # what it held, which the site serves only when it is newer.
                result["next_skipped"] = {"reference_date": next_date, "error": str(exc)}
            if not dry_run:
                verify_crossword_history(output_dir_path, output_dir_path / NEXT_DIRNAME)
        # Prefer today's dataset when both exist: the catalog lives in the main
        # directory beside today's sessions. Fall back to next/ or regenerate.
        datasets = [p for p in (puzzles, next_puzzles) if p is not None and p["dataset"] is not None]
        try:
            result["catalog"] = _publish_run_catalog(
                output_dir_path, connection, catalog, related_clues, dry_run,
                datasets[0] if datasets else None,
            )
        except Exception as exc:
            # The catalog is not a game of the day; a failure withdraws it
            # and leaves the day as published.
            result["catalog"] = None
            result["catalog_skipped"] = {"error": omission_reason(exc)}
            if not dry_run:
                remove_catalog(output_dir_path)
                verify_artifacts(output_dir_path, require_grid=False, require_code_groups=False)
    finally:
        connection.close()
    return result


def _publish_run_catalog(
    output_dir: Path,
    connection: sqlite3.Connection,
    enabled: bool,
    related_clues: bool,
    dry_run: bool,
    puzzles: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Publish (or withdraw) the question catalog of this run; return what it offers.

    The catalog reflects the database of the run, not the day: a day kept or
    promoted from ``next/`` keeps its sessions, while the catalog, which holds
    no history, follows the facts of the moment. It carries the related decade
    clues exactly when ``manifest-v3.json`` does.
    """
    if not enabled:
        if not dry_run and remove_catalog(output_dir):
            return {"withdrawn": True}
        return None
    source = None if puzzles is None else puzzles["enriched_dataset" if related_clues else "dataset"]
    if source is None:
        source, _ = generate_dataset(connection, related_clues=related_clues)
    shards = build_catalog(source)
    manifest = (
        build_catalog_manifest(shards) if dry_run else publish_catalog(output_dir, shards)
    )
    if not dry_run:
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False, require_catalog=True)
    return {
        "catalog_version": manifest["catalog_version"],
        "dataset_version": manifest["dataset_version"],
        "lines": catalog_coverage_lines(manifest, shards, "Quiz catalog"),
        "dry_run": dry_run,
    }
