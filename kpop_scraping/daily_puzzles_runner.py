"""Unified daily puzzle generation and publishing runner.

Deterministically generates and atomically publishes the 7 daily K-pop puzzle games:
1. Daily bilingual quiz sessions (and session.pt-BR.json, session.en.json)
2. Intersection grid (grid.daily.json)
3. Connections puzzle (connections.daily.json)
4. Name guess puzzle (name-guess.daily.json)
5. Word search puzzle (word-search.daily.json)
6. Timeline puzzle (timeline.daily.json)
7. Group code pilot (code-groups.daily.json)

Failure policy (partial publish): a generation failure of the group code
pilot never blocks the daily batch. The other six games of the day still
publish, the day goes out without ``code-groups.daily.json``, and the runner
result records the absence in ``code_groups_skipped`` (with the generation
error). This mirrors the grid's no-previous-fallback skip path; unlike the
grid, the pilot does not reuse a previous day's artifact, because the puzzle
is date-derived and a stale sequence would contradict the day's identity.
The runner's verification passes ``require_code_groups=False`` so a day
without the artifact still verifies, while a present file is always
validated. Callers that must have the artifact pass the
``--require-code-groups`` flag of ``kpop_scraping.web_publish``.
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

from .code_groups_cli import generate as generate_code_groups_puzzle
from .connections_generator import generate_connections_puzzle
from .grid_generator import generate_daily_grid, grid_incompatibility
from .grid_publication import publication, read_publication, write_publication
from .grid_schema import validate_intersection_grid, write_intersection_grid_atomic
from .name_guess_generator import generate_name_guess_puzzle
from .quiz_generator import QuizConfig, generate_dataset
from .quiz_session import create_session
from .quiz_schema import validate_session, write_json_atomic
from .quiz_utils import reference_date_today
from .timeline_generator import generate_timeline_puzzle
from .web_publish import (
    CODE_GROUPS_DAILY_FILENAME,
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
    related_clues: bool = False,
) -> dict[str, Any]:
    """Deterministically generate the 7 daily puzzles for reference_date.

    The group code pilot is best-effort: when its generation fails, the
    returned puzzles carry ``code_groups=None`` plus ``code_groups_error``
    and the day publishes without the artifact (partial publish policy, see
    the module docstring). The other six games still raise on failure.
    """
    iso_date = get_reference_date(reference_date)
    ref_date = date.fromisoformat(iso_date)

    connection.row_factory = sqlite3.Row

    # 1. Daily quiz: 6 base sessions + 6 daily sessions
    dataset, _ = generate_dataset(connection, related_clues=related_clues)
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
    # unset so publish_daily_puzzles can reuse the previous artifact when
    # it is still valid or publish the day without a grid.
    grid = None
    grid_error = None
    try:
        grid = generate_daily_grid(connection, reference_date=ref_date)
    except ValueError as exc:
        grid_error = str(exc)
        sys.stderr.write(f"Daily grid generation failed; reusing the previous grid only if it validates: {exc}\n")

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

    # 7. Group code pilot. Partial publish policy: a failure here only
    # removes this artifact from the day; the other six games still go out.
    code_groups = None
    code_groups_error = None
    try:
        code_groups = generate_code_groups_puzzle(
            connection,
            seed=f"kpop-code-groups-daily-{iso_date}",
            reference_date=ref_date,
        )
    except ValueError as exc:
        code_groups_error = str(exc)
        sys.stderr.write(
            f"Daily group code generation failed; the day publishes without "
            f"code-groups.daily.json: {exc}\n"
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
        "code_groups": code_groups,
        "code_groups_error": code_groups_error,
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

    ``previous_grid`` is the grid reused when generation fails, as long as its
    content still passes validation; it defaults to the one already in
    output_dir. When it is missing or invalid, the day publishes without
    ``grid.daily.json`` and the result records why in ``grid_skipped``.
    With ``connection``, the previous grid must also still satisfy the
    current eligibility policy for its answers, not only the schema.
    The group code pilot follows a plain partial publish policy: when its
    generation failed (``code_groups`` is None), the day publishes without
    ``code-groups.daily.json`` and the result records why in
    ``code_groups_skipped``; no previous artifact is reused.
    With ``prune``, game files outside the new set are removed. Publication
    history remains available to reject cached artifacts from earlier days.
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
            code_groups=puzzles["code_groups"],
        )
        grid_skipped = None
        if puzzles["grid"] is None:
            previous_invalid = _invalid_grid_reason(previous_grid, connection)
            if previous_invalid is None and previous_grid.is_file():
                shutil.copyfile(previous_grid, staging_dir / GRID_DAILY_FILENAME)
            else:
                # No grid to publish; the grid page reports the artifact
                # as missing for this day.
                grid_skipped = {
                    "error": puzzles.get("grid_error") or "unknown error",
                    "previous_invalid": previous_invalid,
                }
        write_json_atomic(staging_dir / "session.pt-BR.json", puzzles["session_pt_br"], validate_session)
        write_json_atomic(staging_dir / "session.en.json", puzzles["session_en"], validate_session)

        # Partial publish policy for the group code pilot: the day goes out
        # without code-groups.daily.json and the result keeps the error.
        code_groups_skipped = (
            {"error": puzzles.get("code_groups_error") or "unknown error"}
            if puzzles["code_groups"] is None
            else None
        )

        # 2. Verify all artifacts in staging directory. The grid and the
        # group code pilot are optional in a published set; when a file is
        # present, verify() validates it.
        verify_artifacts(staging_dir, require_grid=False, require_code_groups=False)

        published_grid = puzzles["grid"]
        grid_reused = None
        if published_grid is None and grid_skipped is None:
            published_grid = json.loads((staging_dir / GRID_DAILY_FILENAME).read_text(encoding="utf-8"))
            # Set only when the previous day's grid was kept.
            grid_reused = {
                "reference_date": published_grid.get("reference_date"),
                "error": puzzles.get("grid_error") or "unknown error",
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
            "connections_id": puzzles["connections"]["puzzle_id"],
            "name_guess_id": puzzles["name_guess"]["puzzle_id"],
            "word_search_id": puzzles["word_search"]["puzzle_id"],
            "timeline_id": puzzles["timeline"]["puzzle_id"],
            "code_groups_id": (
                puzzles["code_groups"]["puzzle_id"] if puzzles["code_groups"] is not None else None
            ),
            "code_groups_skipped": code_groups_skipped,
            "dry_run": dry_run,
            "output_dir": str(output_dir),
            "published_files": [p.name for p in sorted(staging_dir.glob("*.json"))],
        }
        if dry_run:
            return result

        # 3. Atomically copy/replace each file from staging_dir into output_dir
        _install_files(staging_dir, output_dir, prune=prune)
        if grid_skipped is not None:
            # The main directory installs without prune, so a grid left by an
            # earlier day needs an explicit removal here. The next directory
            # installs with prune, which already removes stale files.
            try:
                (output_dir / GRID_DAILY_FILENAME).unlink()
            except FileNotFoundError:
                pass
        if code_groups_skipped is not None:
            # Same reasoning as the grid above: the day publishes without
            # the group code artifact, and a file left by an earlier day
            # must not survive it.
            try:
                (output_dir / CODE_GROUPS_DAILY_FILENAME).unlink()
            except FileNotFoundError:
                pass

        # 4. Final verification in output_dir; the grid and the group code
        # artifact stay optional here too.
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
        return result


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
    except ValueError as exc:
        grid_path.unlink()
        return {**outcome, "action": "removed", "error": str(exc)}
    write_intersection_grid_atomic(grid_path, grid)
    write_publication(output_dir, publication(reference_date, grid, tombstone))
    return {**outcome, "action": "regenerated", "grid_id": grid["grid_id"]}


def _install_files(source_dir: Path, output_dir: Path, prune: bool = False) -> None:
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
            if stale.is_file() and stale.name not in names and not stale.name.startswith("grid-publication."):
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


def _published_result(output_dir: Path, reference_date: str, **flags: Any) -> dict[str, Any]:
    def read(name: str) -> dict[str, Any]:
        return json.loads((output_dir / name).read_text(encoding="utf-8"))

    # A day may be published without a grid; grid_id is None then.
    grid_path = output_dir / GRID_DAILY_FILENAME
    grid = json.loads(grid_path.read_text(encoding="utf-8")) if grid_path.is_file() else None
    # Kept or promoted bytes carry no generation error, so the skip record
    # only marks the artifact as absent for that day.
    grid_skipped = (
        {"error": None, "previous_invalid": None, "published_without_grid": True}
        if grid is None
        else None
    )
    # The group code artifact is optional in a published set; sets published
    # before the daily integration, and days published under the partial
    # publish policy, have no file to read.
    code_groups_path = output_dir / CODE_GROUPS_DAILY_FILENAME
    code_groups = (
        json.loads(code_groups_path.read_text(encoding="utf-8"))
        if code_groups_path.is_file()
        else None
    )
    return {
        "reference_date": reference_date,
        "dataset_version": read(MANIFEST_FILENAME)["dataset_version"],
        "grid_id": grid["grid_id"] if grid is not None else None,
        "grid_reused": None,
        "grid_skipped": grid_skipped,
        "connections_id": read(CONNECTIONS_DAILY_FILENAME)["puzzle_id"],
        "name_guess_id": read(NAME_GUESS_DAILY_FILENAME)["puzzle_id"],
        "word_search_id": read(WORD_SEARCH_DAILY_FILENAME)["puzzle_id"],
        "timeline_id": read(TIMELINE_DAILY_FILENAME)["puzzle_id"],
        "code_groups_id": code_groups["puzzle_id"] if code_groups is not None else None,
        "code_groups_skipped": (
            {"published_without_code_groups": True} if code_groups is None else None
        ),
        "dry_run": False,
        "output_dir": str(output_dir),
        **flags,
    }


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
    """
    # The grid and the group code artifact are optional in a published set;
    # verify() still validates either file when it is present.
    if _published_day(output_dir) == reference_date:
        read_publication(output_dir, reference_date)
        verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
        revalidated = _revalidate_published_grid(output_dir, reference_date, connection) if connection else None
        return _published_result(
            output_dir, reference_date, grid_revalidated=revalidated, already_published=True
        )
    next_dir = output_dir / NEXT_DIRNAME
    if _published_day(next_dir) != reference_date:
        return None
    read_publication(next_dir, reference_date)
    verify_artifacts(next_dir, require_grid=False, require_code_groups=False)
    _install_files(next_dir, output_dir)
    if not (next_dir / GRID_DAILY_FILENAME).is_file():
        # An earlier day's grid is removed when the promoted set has none.
        try:
            (output_dir / GRID_DAILY_FILENAME).unlink()
        except FileNotFoundError:
            pass
    if not (next_dir / CODE_GROUPS_DAILY_FILENAME).is_file():
        # Same as the grid: a group code artifact left by an earlier day
        # does not survive the promotion of a set without one.
        try:
            (output_dir / CODE_GROUPS_DAILY_FILENAME).unlink()
        except FileNotFoundError:
            pass
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
    verify_artifacts(output_dir, require_grid=False, require_code_groups=False)
    return _published_result(
        output_dir, reference_date, grid_revalidated=revalidated, promoted_from_next=True
    )


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
) -> dict[str, Any]:
    """Orchestrate daily puzzles generation and publication.

    With ``ahead``, the next day's set is also published under ``next/`` so
    the site can switch to it at midnight in Sao Paulo, before the next run.
    A day that is already published is kept unless ``regenerate`` is set.
    """
    output_dir_path = Path(output_dir)

    if verify_only:
        # The grid and the group code artifact are optional in a published
        # day; a present file of either still validates.
        verify_artifacts(output_dir_path, require_grid=False, require_code_groups=False)
        next_dir = output_dir_path / NEXT_DIRNAME
        if (next_dir / MANIFEST_FILENAME).is_file():
            verify_artifacts(next_dir, require_grid=False, require_code_groups=False)
        return {
            "status": "verified",
            "output_dir": str(output_dir_path),
        }

    db_path = Path(database)
    if not db_path.is_file():
        raise FileNotFoundError(f"Database does not exist: {db_path}")

    iso_date = get_reference_date(reference_date)

    try:
        connection = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        connection = sqlite3.connect(str(db_path))

    try:
        result = None if dry_run or regenerate else keep_or_promote_day(output_dir_path, iso_date, connection)
        if result is None:
            puzzles = generate_daily_puzzles(
                connection,
                reference_date=iso_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
                related_clues=related_clues,
            )
            result = publish_daily_puzzles(output_dir_path, puzzles, dry_run=dry_run, connection=connection)
        if ahead:
            next_date = (date.fromisoformat(iso_date) + timedelta(days=1)).isoformat()
            next_puzzles = generate_daily_puzzles(
                connection,
                reference_date=next_date,
                base_seed=base_seed,
                timer_seconds=timer_seconds,
                related_clues=related_clues,
            )
            result["next"] = publish_daily_puzzles(
                output_dir_path / NEXT_DIRNAME,
                next_puzzles,
                dry_run=dry_run,
                previous_grid=output_dir_path / GRID_DAILY_FILENAME,
                prune=True,
                connection=connection,
            )
    finally:
        connection.close()
    return result
