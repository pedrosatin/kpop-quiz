"""Record of what a published daily set holds: its date and the games it omits.

The daily runner publishes a partial day when a game's generator fails: the
game's artifact is left out and the other games still go out. Every set the
runner generates carries ``daily-set.json`` beside its artifacts. The record
names the set's date, which no single game can carry once any of them may be
missing, and the reason each absent game was left out. Verification accepts a
required artifact as absent only when this record explains it.

Sets published before the record existed have no ``daily-set.json``; their
date is read from ``connections.daily.json``, which every such set carries.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from .quiz_schema import write_json_atomic

DAILY_SET_FILENAME = "daily-set.json"
DAILY_SET_VERSION = "kpop-daily-set-v1"
# Games of a daily set, named as the board swap gate names them.
GAMES = (
    "quiz",
    "grid",
    "connections",
    "name-guess",
    "word-search",
    "timeline",
    "code-groups",
    "crossword",
)
# An omission reason may quote data from Wikipedia or Wikidata through an
# exception message; the record and the run summary keep a bounded line.
MAX_REASON_LENGTH = 500


def omission_reason(exc: BaseException) -> str:
    """One bounded line that says why a game was left out.

    A ``ValueError`` is the documented failure of the generators, and its
    message is the reason; any other exception is named by its type too,
    because its message alone may be empty (``MemoryError``) or unclear.
    """
    message = str(exc)
    if not isinstance(exc, ValueError) or not message:
        message = f"{type(exc).__name__}: {message}" if message else type(exc).__name__
    return single_line(message)


def single_line(text: str) -> str:
    """Replace control characters with spaces and cut the text to the limit.

    The reason is printed to the job log, where a line break could start a
    workflow command of its own.
    """
    flat = " ".join("".join(" " if ord(char) < 32 or ord(char) == 127 else char for char in text).split())
    if len(flat) > MAX_REASON_LENGTH:
        flat = flat[: MAX_REASON_LENGTH - 1] + "…"
    return flat


def validate_daily_set(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"schema_version", "reference_date", "omitted"}:
        raise ValueError("invalid daily set fields")
    if value["schema_version"] != DAILY_SET_VERSION:
        raise ValueError("invalid daily set schema_version")
    day = value["reference_date"]
    try:
        valid_day = isinstance(day, str) and date.fromisoformat(day).isoformat() == day
    except ValueError:
        valid_day = False
    if not valid_day:
        raise ValueError("invalid daily set reference_date")
    omitted = value["omitted"]
    if not isinstance(omitted, dict):
        raise ValueError("invalid daily set omitted games")
    for game, reason in omitted.items():
        if game not in GAMES:
            raise ValueError(f"unknown game in daily set: {game!r}")
        if not isinstance(reason, str) or not reason or reason != single_line(reason):
            raise ValueError(f"invalid omission reason for {game} in daily set")
    if len(omitted) == len(GAMES):
        raise ValueError("daily set omits every game")


def daily_set(reference_date: str, omitted: dict[str, str]) -> dict[str, Any]:
    value = {
        "schema_version": DAILY_SET_VERSION,
        "reference_date": reference_date,
        "omitted": {game: omitted[game] for game in GAMES if game in omitted},
    }
    validate_daily_set(value)
    return value


def read_daily_set(directory: Path) -> dict[str, Any] | None:
    """The record of the set in ``directory``; None when the set predates it."""
    path = Path(directory) / DAILY_SET_FILENAME
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read daily set {path}: {exc}") from exc
    validate_daily_set(value)
    return value


def write_daily_set(directory: Path, value: dict[str, Any]) -> None:
    write_json_atomic(Path(directory) / DAILY_SET_FILENAME, value, validate_daily_set)


def note_omission(directory: Path, game: str, reason: str | None) -> None:
    """Record that ``game`` left the set in ``directory`` (or came back, with None).

    A kept or promoted day may lose its grid or crossword, or get a crossword
    back, after it was published. A set without a record is left as it is.
    """
    value = read_daily_set(directory)
    if value is None:
        return
    omitted = dict(value["omitted"])
    if reason is None:
        omitted.pop(game, None)
    else:
        omitted[game] = single_line(reason)
    write_daily_set(directory, daily_set(value["reference_date"], omitted))
