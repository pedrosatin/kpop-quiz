"""Gate of the daily cron: a published day's boards change only when declared.

Players finish a day against the boards published for it, and their stats and
saves are keyed by those boards. The cron may replace a board of a date that
is already published in ``web/public/data`` in three cases only: the run was
asked to ``--regenerate``, or the runner declared the swap itself (the grid
revalidation of a kept or promoted day, a crossword generated again on
promotion). Any other swap fails the step before the upload, naming the game
and the date. A date counts as published once the site serves it: in the
main directory, or in ``next/`` from midnight in Sao Paulo until its promotion.
``next/`` itself is not compared with its earlier self: the run builds the
next day's set again until it is served.

The identity of the "before" side is read from a git ref, the "after" side from
the working tree, so the check runs on the cron's checkout between generation
and upload. The runner's declarations arrive as the JSON file written by
``daily_puzzles_cli --board-swaps-file``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from .web_publish import (
    CODE_GROUPS_DAILY_FILENAME,
    CONNECTIONS_DAILY_FILENAME,
    CROSSWORD_DAILY_FILENAME,
    GRID_DAILY_FILENAME,
    MANIFEST_FILENAME,
    NAME_GUESS_DAILY_FILENAME,
    TIMELINE_DAILY_FILENAME,
    WORD_SEARCH_DAILY_FILENAME,
)


def _quiz_id(manifest: dict[str, Any]) -> str:
    sessions = manifest["sessions"]
    ids = [sessions[key]["session_id"] for key in sorted(sessions) if key.startswith("daily.")]
    return hashlib.sha256(",".join(ids).encode()).hexdigest()


def _puzzle_id(payload: dict[str, Any]) -> str:
    return payload["puzzle_id"]


def _crossword_id(payload: dict[str, Any]) -> str | None:
    # An omitted day has no board to swap.
    return payload["dataset_version"] if payload["status"] == "ready" else None


# game -> (file that holds the board, identity of the board in that file)
BOARDS: dict[str, tuple[str, Callable[[dict[str, Any]], str | None]]] = {
    "quiz": (MANIFEST_FILENAME, _quiz_id),
    "grid": (GRID_DAILY_FILENAME, lambda payload: payload["grid_id"]),
    "connections": (CONNECTIONS_DAILY_FILENAME, _puzzle_id),
    "name-guess": (NAME_GUESS_DAILY_FILENAME, _puzzle_id),
    "word-search": (WORD_SEARCH_DAILY_FILENAME, _puzzle_id),
    "timeline": (TIMELINE_DAILY_FILENAME, _puzzle_id),
    "code-groups": (CODE_GROUPS_DAILY_FILENAME, _puzzle_id),
    "crossword": (CROSSWORD_DAILY_FILENAME, _crossword_id),
}


def board_ids(read: Callable[[str], dict[str, Any] | None]) -> tuple[str | None, dict[str, str]]:
    """Return the published day and the identity of each board a directory holds.

    The day is the date of ``connections.daily.json``, as the runner reads it.
    A game without a file, or without a board, has no entry.
    """
    connections = read(CONNECTIONS_DAILY_FILENAME)
    day = connections.get("reference_date") if connections else None
    ids = {}
    for game, (filename, identify) in BOARDS.items():
        payload = read(filename)
        identity = identify(payload) if payload is not None else None
        if identity is not None:
            ids[game] = identity
    return day, ids


def _read_base(repo: Path, ref: str, data_dir: str) -> Callable[[str], dict[str, Any] | None]:
    resolved = subprocess.run(
        ["git", "rev-parse", "--verify", f"{ref}^{{commit}}"],
        cwd=repo, capture_output=True, text=True,
    )
    if resolved.returncode != 0:
        raise ValueError(f"Base ref {ref!r} is not a commit: {resolved.stderr.strip()}")

    def read(name: str) -> dict[str, Any] | None:
        shown = subprocess.run(
            ["git", "show", f"{ref}:{data_dir}/{name}"], cwd=repo, capture_output=True,
        )
        return json.loads(shown.stdout) if shown.returncode == 0 else None

    return read


def _read_tree(directory: Path) -> Callable[[str], dict[str, Any] | None]:
    def read(name: str) -> dict[str, Any] | None:
        path = directory / name
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    return read


def check_board_swaps(
    repo: Path, data_dir: str, base_ref: str, declaration: dict[str, Any]
) -> tuple[list[str], list[str]]:
    """Compare the day the working tree publishes with the same date at ``base_ref``.

    The date counts at the base when its set was in the main directory or in
    ``next/``. Returns (accepted, refused): one line per swapped board. A swap
    is accepted when the run was asked to regenerate or the runner declared it
    for that game and date. Nothing is compared when the base held no set for
    the date, as on the first day or when the run moved to a day not served yet.
    """
    day, after = board_ids(_read_tree(repo / data_dir))
    declared = {
        (swap["game"], swap["date"]): swap["reason"] for swap in declaration["swaps"]
    }
    accepted, refused = [], []
    for source in (data_dir, f"{data_dir}/next"):
        base_day, before = board_ids(_read_base(repo, base_ref, source))
        if day is None or base_day != day:
            continue
        for game, old in before.items():
            new = after.get(game)
            if new == old:
                continue
            change = (
                f"{game} for {day} (served from {source}): "
                f"board {old[:12]} became {new[:12] if new else 'absent'}"
            )
            if declaration["regenerate"]:
                accepted.append(f"{change} (requested by --regenerate)")
            elif (game, day) in declared:
                accepted.append(f"{change} (declared by the runner: {declared[(game, day)]})")
            else:
                refused.append(change)
    return accepted, refused


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-ref", default="HEAD", help="Commit that holds the published data")
    parser.add_argument("--data-dir", default="web/public/data", help="Repository-relative data directory")
    parser.add_argument(
        "--board-swaps-file", type=Path, required=True,
        help="JSON written by daily_puzzles_cli --board-swaps-file",
    )
    args = parser.parse_args(argv)
    try:
        declaration = json.loads(args.board_swaps_file.read_text(encoding="utf-8"))
        accepted, refused = check_board_swaps(Path.cwd(), args.data_dir, args.base_ref, declaration)
    except (OSError, ValueError, KeyError) as exc:
        sys.stderr.write(f"Board swap check could not run: {exc}\n")
        return 1
    for line in accepted:
        print(f"Board swap accepted: {line}")
    for line in refused:
        sys.stderr.write(f"Board swap not declared: {line}\n")
    if refused:
        sys.stderr.write(
            "A published day keeps its boards unless the run is started with --regenerate "
            "or the runner declares the swap.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
