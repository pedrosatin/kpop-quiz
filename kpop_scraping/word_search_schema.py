"""Schema checks and validation for word search puzzle artifacts."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .quiz_schema import write_json_atomic

WORD_SEARCH_SCHEMA_VERSION = "kpop-word-search-puzzle-v1"

WORD_SEARCH_REQUIRED_ROOT_FIELDS = frozenset(
    {
        "schema_version",
        "puzzle_id",
        "dataset_version",
        "reference_date",
        "theme",
        "dimensions",
        "grid",
        "words",
    }
)

WORD_SEARCH_OPTIONAL_ROOT_FIELDS = frozenset({"theme_description"})
WORD_SEARCH_ALL_ROOT_FIELDS = WORD_SEARCH_REQUIRED_ROOT_FIELDS | WORD_SEARCH_OPTIONAL_ROOT_FIELDS

DIMENSIONS_FIELDS = frozenset({"rows", "cols"})

WORD_ENTRY_REQUIRED_FIELDS = frozenset(
    {
        "id",
        "word",
        "canonical_name",
        "labels",
        "start_row",
        "start_col",
        "end_row",
        "end_col",
        "evidence",
    }
)

WORD_ENTRY_OPTIONAL_FIELDS = frozenset({"clue"})
WORD_ENTRY_ALL_FIELDS = WORD_ENTRY_REQUIRED_FIELDS | WORD_ENTRY_OPTIONAL_FIELDS

BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WORD_PATTERN = re.compile(r"^[A-Z]{3,16}$")
_GRID_CELL_PATTERN = re.compile(r"^[A-Z]$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid word search puzzle schema: {message}")


def _require_hash(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_HASH_PATTERN.match(value)),
        f"{field_name} must be a 64-character lowercase hex string",
    )


def _require_qid(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_QID_PATTERN.match(value)),
        f"{field_name} must match pattern ^Q[1-9][0-9]*$",
    )


def _require_date(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_DATE_PATTERN.match(value)),
        f"{field_name} must be a valid ISO date YYYY-MM-DD",
    )
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"Invalid word search puzzle schema: {field_name} is not a calendar date"
        ) from exc


def _require_bilingual_text(value: Any, field_name: str) -> None:
    _require(isinstance(value, dict), f"{field_name} must be an object")
    _require(set(value.keys()) == BILINGUAL_FIELDS, f"{field_name} fields must be pt-BR and en")
    for lang in ("pt-BR", "en"):
        _require(
            isinstance(value[lang], str) and len(value[lang]) > 0,
            f"{field_name}.{lang} must be a non-empty string",
        )


def _validate_evidence(evidence: Any, context: str) -> None:
    _require(isinstance(evidence, dict), f"{context} evidence item must be an object")
    _require(
        set(evidence.keys()) == EVIDENCE_FIELDS,
        f"{context} evidence item contains unexpected or missing fields",
    )
    _require(
        isinstance(evidence["fact_base_id"], str) and len(evidence["fact_base_id"]) > 0,
        f"{context} fact_base_id must be a non-empty string",
    )
    _require(
        isinstance(evidence["locator"], str) and len(evidence["locator"]) > 0,
        f"{context} locator must be a non-empty string",
    )
    _require(
        type(evidence["revision_id"]) is int and evidence["revision_id"] >= 1,
        f"{context} revision_id must be an integer >= 1",
    )
    _require(
        isinstance(evidence["source_key"], str) and len(evidence["source_key"]) > 0,
        f"{context} source_key must be a non-empty string",
    )
    source_url = evidence["source_url"]
    _require(
        isinstance(source_url, str) and source_url.startswith("https://"),
        f"{context} source_url must be an https URL",
    )
    parts = urlsplit(source_url)
    _require(bool(parts.netloc), f"{context} source_url netloc cannot be empty")


def extract_word_coordinates(
    start_row: int, start_col: int, end_row: int, end_col: int
) -> list[tuple[int, int]]:
    """Extract list of coordinates (row, col) traversed in a straight line.

    Valid directions are horizontal, vertical, and 45-degree diagonal.
    Raises ValueError if coordinates do not form a straight line or are not integers.
    """
    for name, val in [
        ("start_row", start_row),
        ("start_col", start_col),
        ("end_row", end_row),
        ("end_col", end_col),
    ]:
        if type(val) is not int:
            raise ValueError(f"{name} must be an integer, got {type(val).__name__}")

    if start_row == end_row and start_col == end_col:
        raise ValueError(
            f"Start coordinates ({start_row}, {start_col}) and end coordinates ({end_row}, {end_col}) must be distinct"
        )

    dr = end_row - start_row
    dc = end_col - start_col

    if dr != 0 and dc != 0 and abs(dr) != abs(dc):
        raise ValueError(
            f"Coordinates ({start_row}, {start_col}) -> ({end_row}, {end_col}) do not form a straight line "
            "(must be horizontal, vertical, or 45-degree diagonal)"
        )

    step_r = 0 if dr == 0 else (1 if dr > 0 else -1)
    step_c = 0 if dc == 0 else (1 if dc > 0 else -1)
    num_steps = max(abs(dr), abs(dc))

    return [(start_row + i * step_r, start_col + i * step_c) for i in range(num_steps + 1)]


def check_word_in_grid(
    grid: list[list[str]], start_row: int, start_col: int, end_row: int, end_col: int
) -> str:
    """Extract and return the string formed by grid letters at specified coordinates.

    Raises ValueError if grid is invalid or coordinates fall outside the grid bounds.
    """
    if not isinstance(grid, list) or len(grid) == 0:
        raise ValueError("Grid must be a non-empty 2D list")

    coords = extract_word_coordinates(start_row, start_col, end_row, end_col)
    rows = len(grid)
    chars: list[str] = []

    for r, c in coords:
        if not (0 <= r < rows):
            raise ValueError(f"Coordinate ({r}, {c}) row is out of grid bounds [0, {rows})")
        if not isinstance(grid[r], list):
            raise ValueError(f"Grid row {r} must be a list")
        cols = len(grid[r])
        if not (0 <= c < cols):
            raise ValueError(f"Coordinate ({r}, {c}) col is out of grid bounds [0, {cols})")
        cell = grid[r][c]
        if not isinstance(cell, str):
            raise ValueError(f"Grid cell at ({r}, {c}) must be a string")
        chars.append(cell)

    return "".join(chars)


def generate_word_search_share_summary(
    reference_date: str,
    found_count: int,
    total_words: int,
    elapsed_seconds: int | None = None,
) -> str:
    """Generate a shareable text summary for a word search game."""
    summary = f"K-pop Word Search {reference_date} {found_count}/{total_words}"
    if elapsed_seconds is not None:
        secs = max(0, int(elapsed_seconds))
        mins = secs // 60
        rem_secs = secs % 60
        return f"{summary} ({mins:02d}:{rem_secs:02d})"
    return summary


def validate_word_search_puzzle(payload: dict[str, Any]) -> None:
    """Validate that payload conforms to kpop-word-search-puzzle-v1 specification.

    Raises ValueError when the payload is invalid.
    """
    _require(isinstance(payload, dict), "root payload must be an object")
    _require(
        WORD_SEARCH_REQUIRED_ROOT_FIELDS.issubset(set(payload.keys())),
        f"root payload is missing required fields: {sorted(WORD_SEARCH_REQUIRED_ROOT_FIELDS - set(payload.keys()))}",
    )
    _require(
        set(payload.keys()).issubset(WORD_SEARCH_ALL_ROOT_FIELDS),
        f"root payload has unexpected fields: {sorted(set(payload.keys()) - WORD_SEARCH_ALL_ROOT_FIELDS)}",
    )
    _require(
        payload["schema_version"] == WORD_SEARCH_SCHEMA_VERSION,
        f"schema_version must be {WORD_SEARCH_SCHEMA_VERSION}",
    )
    _require_hash(payload["puzzle_id"], "puzzle_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")

    # Theme
    _require_bilingual_text(payload["theme"], "theme")
    if "theme_description" in payload:
        _require_bilingual_text(payload["theme_description"], "theme_description")

    # Dimensions
    dimensions = payload["dimensions"]
    _require(isinstance(dimensions, dict), "dimensions must be an object")
    _require(
        set(dimensions.keys()) == DIMENSIONS_FIELDS,
        f"dimensions fields must be rows and cols, got {sorted(dimensions.keys())}",
    )
    rows = dimensions["rows"]
    cols = dimensions["cols"]
    _require(
        type(rows) is int and 8 <= rows <= 16,
        "dimensions.rows must be an integer between 8 and 16",
    )
    _require(
        type(cols) is int and 8 <= cols <= 16,
        "dimensions.cols must be an integer between 8 and 16",
    )

    # Grid
    grid = payload["grid"]
    _require(isinstance(grid, list), "grid must be a 2D array")
    _require(
        len(grid) == rows,
        f"grid row count ({len(grid)}) does not match dimensions.rows ({rows})",
    )
    for r_idx, row in enumerate(grid):
        _require(isinstance(row, list), f"grid[{r_idx}] must be an array")
        _require(
            len(row) == cols,
            f"grid[{r_idx}] column count ({len(row)}) does not match dimensions.cols ({cols})",
        )
        for c_idx, cell in enumerate(row):
            _require(
                isinstance(cell, str) and bool(_GRID_CELL_PATTERN.match(cell)),
                f"grid[{r_idx}][{c_idx}] ('{cell}') must be a single uppercase ASCII character ^[A-Z]$",
            )

    # Words
    words = payload["words"]
    _require(isinstance(words, list), "words must be an array")
    _require(
        3 <= len(words) <= 20,
        f"words must contain between 3 and 20 items, got {len(words)}",
    )

    seen_ids: set[str] = set()
    seen_words: set[str] = set()

    for idx, word_obj in enumerate(words):
        context = f"words[{idx}]"
        _require(isinstance(word_obj, dict), f"{context} must be an object")
        _require(
            WORD_ENTRY_REQUIRED_FIELDS.issubset(set(word_obj.keys())),
            f"{context} is missing required fields: {sorted(WORD_ENTRY_REQUIRED_FIELDS - set(word_obj.keys()))}",
        )
        _require(
            set(word_obj.keys()).issubset(WORD_ENTRY_ALL_FIELDS),
            f"{context} contains unexpected fields: {sorted(set(word_obj.keys()) - WORD_ENTRY_ALL_FIELDS)}",
        )

        # ID (QID)
        qid = word_obj["id"]
        _require_qid(qid, f"{context}.id")
        _require(qid not in seen_ids, f"duplicate word id {qid} at {context}")
        seen_ids.add(qid)

        # Word string
        word_str = word_obj["word"]
        _require(
            isinstance(word_str, str) and bool(_WORD_PATTERN.match(word_str)),
            f"{context}.word ('{word_str}') must be an uppercase string matching ^[A-Z]{{3,16}}$",
        )
        _require(word_str not in seen_words, f"duplicate word '{word_str}' at {context}")
        seen_words.add(word_str)

        # Canonical name and labels
        _require(
            isinstance(word_obj["canonical_name"], str) and len(word_obj["canonical_name"]) > 0,
            f"{context}.canonical_name must be a non-empty string",
        )
        _require_bilingual_text(word_obj["labels"], f"{context}.labels")

        # Coordinates
        start_row = word_obj["start_row"]
        start_col = word_obj["start_col"]
        end_row = word_obj["end_row"]
        end_col = word_obj["end_col"]

        for coord_name, coord_val, limit, dim_name in [
            ("start_row", start_row, rows, "rows"),
            ("start_col", start_col, cols, "cols"),
            ("end_row", end_row, rows, "rows"),
            ("end_col", end_col, cols, "cols"),
        ]:
            _require(
                type(coord_val) is int and 0 <= coord_val < limit,
                f"{context}.{coord_name} ({coord_val}) must be an integer in range [0, dimensions.{dim_name}) ([0, {limit}))",
            )

        # Coordinates straight line validation
        try:
            coords = extract_word_coordinates(start_row, start_col, end_row, end_col)
        except ValueError as exc:
            raise ValueError(f"Invalid word search puzzle schema: {context} coordinates error: {exc}") from exc

        # Length validation
        _require(
            len(coords) == len(word_str),
            f"{context}.word length ({len(word_str)}) does not match coordinate segment length ({len(coords)})",
        )

        # Letters alignment with grid
        grid_letters = "".join(grid[r][c] for r, c in coords)
        _require(
            grid_letters == word_str,
            f"{context}.word ('{word_str}') does not match grid letters ('{grid_letters}') along path",
        )

        # Clue (optional)
        if "clue" in word_obj:
            _require_bilingual_text(word_obj["clue"], f"{context}.clue")

        # Evidence
        evidence = word_obj["evidence"]
        _require(isinstance(evidence, list), f"{context}.evidence must be an array")
        _require(len(evidence) >= 1, f"{context}.evidence must contain at least one item")
        for ev_idx, ev in enumerate(evidence):
            _validate_evidence(ev, f"{context}.evidence[{ev_idx}]")


def _clue_key(text: dict[str, str]) -> tuple[str, str]:
    return (text["pt-BR"].strip().casefold(), text["en"].strip().casefold())


def validate_word_search_clues(payload: dict[str, Any]) -> None:
    """Reject clues that give the player nothing beyond the theme title.

    A clue may not repeat the theme in either locale, and a puzzle with two or
    more clued words may not give all of them the same clue.  Words without a
    clue are allowed.  Call after ``validate_word_search_puzzle``.

    The generator enforces this check on every puzzle it builds.  It is kept
    out of ``validate_word_search_puzzle`` so that artifacts published before
    the per-word clue rule still pass structural verification until the next
    daily regeneration replaces them.
    """
    theme = _clue_key(payload["theme"])
    clue_keys: set[tuple[str, str]] = set()
    clued = 0
    for idx, word_obj in enumerate(payload["words"]):
        clue = word_obj.get("clue")
        if clue is None:
            continue
        key = _clue_key(clue)
        for lang_idx, lang in enumerate(("pt-BR", "en")):
            _require(
                key[lang_idx] != theme[lang_idx],
                f"words[{idx}].clue.{lang} repeats the theme title",
            )
        clue_keys.add(key)
        clued += 1
    _require(
        clued < 2 or len(clue_keys) > 1,
        "all word clues are identical; clues must tell words apart or be omitted",
    )


def write_word_search_puzzle_atomic(target_path: Path, payload: dict[str, Any]) -> bytes:
    """Validate and atomically write a word search puzzle JSON file."""
    return write_json_atomic(target_path, payload, validate_word_search_puzzle)
