"""Schema checks and validation for Strands puzzle artifacts.

A Strands puzzle is a letter grid fully partitioned into word paths.  Each
path steps between the 8 neighbours of a cell, no cell belongs to two paths
and every cell belongs to one.  Exactly one path, the spangram, touches two
opposite sides of the grid.  Solution uniqueness is proved by the generator;
this module checks the structural contract only.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .quiz_schema import write_json_atomic
from .quiz_utils import hash_payload
from .word_search_schema import normalize_word

STRANDS_SCHEMA_VERSION = "kpop-strands-puzzle-v1"

STRANDS_MIN_SIDE = 9
STRANDS_MAX_SIDE = 10
STRANDS_MIN_WORDS = 6
STRANDS_MAX_WORDS = 9
STRANDS_MIN_WORD_LENGTH = 3

STRANDS_REQUIRED_ROOT_FIELDS = frozenset(
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
STRANDS_OPTIONAL_ROOT_FIELDS = frozenset({"theme_description"})
STRANDS_ALL_ROOT_FIELDS = STRANDS_REQUIRED_ROOT_FIELDS | STRANDS_OPTIONAL_ROOT_FIELDS

DIMENSIONS_FIELDS = frozenset({"rows", "cols"})
BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

WORD_COMMON_REQUIRED_FIELDS = frozenset({"word", "labels", "is_spangram", "cells"})
WORD_ENTITY_FIELDS = frozenset({"id", "canonical_name", "evidence"})
WORD_ALL_FIELDS = WORD_COMMON_REQUIRED_FIELDS | WORD_ENTITY_FIELDS

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WORD_PATTERN = re.compile(r"^[A-Z]{3,}$")
_GRID_CELL_PATTERN = re.compile(r"^[A-Z]$")

Cell = tuple[int, int]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid strands puzzle schema: {message}")


def _require_date(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_DATE_PATTERN.match(value)),
        f"{field_name} must be a valid ISO date YYYY-MM-DD",
    )
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"Invalid strands puzzle schema: {field_name} is not a calendar date"
        ) from exc


def _require_bilingual_text(value: Any, field_name: str) -> None:
    _require(isinstance(value, dict), f"{field_name} must be an object")
    _require(
        value.keys() == BILINGUAL_FIELDS, f"{field_name} fields must be pt-BR and en"
    )
    for lang in ("pt-BR", "en"):
        _require(
            isinstance(value[lang], str) and len(value[lang]) > 0,
            f"{field_name}.{lang} must be a non-empty string",
        )


def _validate_evidence(evidence: Any, context: str) -> None:
    _require(isinstance(evidence, dict), f"{context} must be an object")
    _require(
        evidence.keys() == EVIDENCE_FIELDS,
        f"{context} contains unexpected or missing fields",
    )
    for name in ("fact_base_id", "locator", "source_key"):
        _require(
            isinstance(evidence[name], str) and len(evidence[name]) > 0,
            f"{context}.{name} must be a non-empty string",
        )
    _require(
        type(evidence["revision_id"]) is int and evidence["revision_id"] >= 1,
        f"{context}.revision_id must be an integer >= 1",
    )
    source_url = evidence["source_url"]
    _require(
        isinstance(source_url, str) and source_url.startswith("https://"),
        f"{context}.source_url must be an https URL",
    )
    _require(bool(urlsplit(source_url).netloc), f"{context}.source_url netloc cannot be empty")


def _require_hash(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_HASH_PATTERN.match(value)),
        f"{field_name} must be a 64-character lowercase hex string",
    )


def compute_strands_puzzle_id(payload: dict[str, Any]) -> str:
    """Return the SHA-256 of the canonical JSON payload without ``puzzle_id``."""
    return hash_payload({k: v for k, v in payload.items() if k != "puzzle_id"})


def are_neighbors(a: Cell, b: Cell) -> bool:
    """Return True when two distinct cells touch, including diagonally."""
    return a != b and abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1


def spans_opposite_sides(cells: list[Cell], rows: int, cols: int) -> bool:
    """Return True when the path touches top and bottom, or left and right."""
    row_values = {r for r, _ in cells}
    col_values = {c for _, c in cells}
    top_bottom = 0 in row_values and rows - 1 in row_values
    left_right = 0 in col_values and cols - 1 in col_values
    return top_bottom or left_right


def find_crossing(paths: list[list[Cell]]) -> tuple[Cell, Cell] | None:
    """Return one diagonal step that crosses another diagonal step, if any.

    Two diagonal steps cross when they are the two diagonals of the same
    2x2 square, for example (0,0)->(1,1) and (0,1)->(1,0).  Crossings make
    the drawn paths ambiguous, so the contract forbids them within a word
    and between words.
    """
    steps: set[frozenset[Cell]] = set()
    for path in paths:
        for a, b in zip(path, path[1:]):
            steps.add(frozenset((a, b)))
    for path in paths:
        for a, b in zip(path, path[1:]):
            if a[0] != b[0] and a[1] != b[1]:
                other = frozenset(((a[0], b[1]), (b[0], a[1])))
                if other in steps:
                    return a, b
    return None


def _validate_root_fields(payload: Any) -> None:
    _require(isinstance(payload, dict), "root payload must be an object")
    keys = payload.keys()
    missing = STRANDS_REQUIRED_ROOT_FIELDS - keys
    _require(not missing, f"root payload is missing required fields: {sorted(missing)}")
    unexpected = keys - STRANDS_ALL_ROOT_FIELDS
    _require(
        not unexpected, f"root payload has unexpected fields: {sorted(unexpected)}"
    )
    _require(
        payload["schema_version"] == STRANDS_SCHEMA_VERSION,
        f"schema_version must be {STRANDS_SCHEMA_VERSION}",
    )
    _require_hash(payload["puzzle_id"], "puzzle_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")
    _require_bilingual_text(payload["theme"], "theme")
    if "theme_description" in payload:
        _require_bilingual_text(payload["theme_description"], "theme_description")


def _validate_dimensions(dimensions: Any) -> tuple[int, int]:
    _require(isinstance(dimensions, dict), "dimensions must be an object")
    _require(
        dimensions.keys() == DIMENSIONS_FIELDS,
        f"dimensions fields must be rows and cols, got {sorted(dimensions.keys())}",
    )
    for name in ("rows", "cols"):
        value = dimensions[name]
        _require(
            type(value) is int and STRANDS_MIN_SIDE <= value <= STRANDS_MAX_SIDE,
            f"dimensions.{name} must be an integer between "
            f"{STRANDS_MIN_SIDE} and {STRANDS_MAX_SIDE}",
        )
    return dimensions["rows"], dimensions["cols"]


def _validate_grid(grid: Any, rows: int, cols: int) -> None:
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
                f"grid[{r_idx}][{c_idx}] must be a single uppercase ASCII letter",
            )


def _validate_cells(cells: Any, context: str, rows: int, cols: int) -> list[Cell]:
    _require(isinstance(cells, list), f"{context}.cells must be an array")
    path: list[Cell] = []
    for idx, cell in enumerate(cells):
        cell_ctx = f"{context}.cells[{idx}]"
        _require(
            isinstance(cell, list) and len(cell) == 2,
            f"{cell_ctx} must be a [row, col] pair",
        )
        row, col = cell
        _require(
            type(row) is int and 0 <= row < rows,
            f"{cell_ctx} row ({row}) must be an integer in [0, {rows})",
        )
        _require(
            type(col) is int and 0 <= col < cols,
            f"{cell_ctx} col ({col}) must be an integer in [0, {cols})",
        )
        current = (row, col)
        _require(current not in path, f"{cell_ctx} reuses cell {list(current)}")
        if path:
            _require(
                are_neighbors(path[-1], current),
                f"{cell_ctx} {list(current)} is not adjacent to {list(path[-1])}",
            )
        path.append(current)
    return path


def _validate_word_entry(
    word_obj: Any,
    idx: int,
    rows: int,
    cols: int,
    seen_ids: set[str],
    seen_words: set[str],
) -> tuple[list[Cell], bool]:
    context = f"words[{idx}]"
    _require(isinstance(word_obj, dict), f"{context} must be an object")
    keys = word_obj.keys()
    missing = WORD_COMMON_REQUIRED_FIELDS - keys
    _require(not missing, f"{context} is missing required fields: {sorted(missing)}")
    unexpected = keys - WORD_ALL_FIELDS
    _require(not unexpected, f"{context} contains unexpected fields: {sorted(unexpected)}")

    is_spangram = word_obj["is_spangram"]
    _require(type(is_spangram) is bool, f"{context}.is_spangram must be a boolean")

    word = word_obj["word"]
    _require(
        isinstance(word, str) and bool(_WORD_PATTERN.match(word)),
        f"{context}.word must be uppercase ASCII letters, at least "
        f"{STRANDS_MIN_WORD_LENGTH} long",
    )
    _require(word not in seen_words, f"duplicate word '{word}' at {context}")
    seen_words.add(word)

    _require_bilingual_text(word_obj["labels"], f"{context}.labels")
    normalized = {lang: normalize_word(word_obj["labels"][lang]) for lang in ("pt-BR", "en")}
    if is_spangram:
        _require(
            word in normalized.values(),
            f"{context}.labels must normalize to '{word}' in at least one locale",
        )
    else:
        for lang, value in normalized.items():
            _require(
                value == word,
                f"{context}.labels.{lang} normalizes to '{value}', which does not match word '{word}'",
            )

    entity_keys = keys & WORD_ENTITY_FIELDS
    if is_spangram:
        _require(
            entity_keys in (frozenset(), WORD_ENTITY_FIELDS),
            f"{context} spangram must carry id, canonical_name and evidence together or none of them",
        )
    else:
        _require(
            entity_keys == WORD_ENTITY_FIELDS,
            f"{context} theme word requires id, canonical_name and evidence",
        )
    if entity_keys:
        qid = word_obj["id"]
        _require(
            isinstance(qid, str) and bool(_QID_PATTERN.match(qid)),
            f"{context}.id must match pattern ^Q[1-9][0-9]*$",
        )
        _require(qid not in seen_ids, f"duplicate word id {qid} at {context}")
        seen_ids.add(qid)
        _require(
            isinstance(word_obj["canonical_name"], str) and len(word_obj["canonical_name"]) > 0,
            f"{context}.canonical_name must be a non-empty string",
        )
        evidence = word_obj["evidence"]
        _require(
            isinstance(evidence, list) and len(evidence) >= 1,
            f"{context}.evidence must be a non-empty array",
        )
        for ev_idx, ev in enumerate(evidence):
            _validate_evidence(ev, f"{context}.evidence[{ev_idx}]")

    path = _validate_cells(word_obj["cells"], context, rows, cols)
    _require(
        len(path) == len(word),
        f"{context}.word length ({len(word)}) does not match cell count ({len(path)})",
    )
    return path, is_spangram


def validate_strands_puzzle(payload: dict[str, Any]) -> None:
    """Validate that payload conforms to kpop-strands-puzzle-v1.

    Raises ValueError when the payload is invalid.
    """
    _validate_root_fields(payload)
    rows, cols = _validate_dimensions(payload["dimensions"])
    grid = payload["grid"]
    _validate_grid(grid, rows, cols)

    words = payload["words"]
    _require(isinstance(words, list), "words must be an array")
    _require(
        STRANDS_MIN_WORDS <= len(words) <= STRANDS_MAX_WORDS,
        f"words must contain between {STRANDS_MIN_WORDS} and {STRANDS_MAX_WORDS} "
        f"items including the spangram, got {len(words)}",
    )

    seen_ids: set[str] = set()
    seen_words: set[str] = set()
    paths: list[list[Cell]] = []
    spangram_indexes: list[int] = []
    for idx, word_obj in enumerate(words):
        path, is_spangram = _validate_word_entry(
            word_obj, idx, rows, cols, seen_ids, seen_words
        )
        paths.append(path)
        if is_spangram:
            spangram_indexes.append(idx)

    owner: dict[Cell, int] = {}
    for idx, path in enumerate(paths):
        for cell in path:
            _require(
                cell not in owner,
                f"words[{idx}] reuses cell {list(cell)} already used by words[{owner.get(cell)}]",
            )
            owner[cell] = idx

    uncovered = [
        [r, c] for r in range(rows) for c in range(cols) if (r, c) not in owner
    ]
    _require(
        not uncovered,
        f"grid is not fully covered; {len(uncovered)} cells belong to no word, "
        f"first {uncovered[0] if uncovered else None}",
    )

    crossing = find_crossing(paths)
    _require(
        crossing is None,
        f"diagonal step {[list(c) for c in crossing] if crossing else None} crosses another path",
    )

    for idx, path in enumerate(paths):
        letters = "".join(grid[r][c] for r, c in path)
        word = words[idx]["word"]
        _require(
            letters == word,
            f"words[{idx}].word ('{word}') does not match grid letters ('{letters}') along its cells",
        )

    _require(
        len(spangram_indexes) == 1,
        f"exactly one word must be the spangram, got {len(spangram_indexes)}",
    )
    spangram_idx = spangram_indexes[0]
    _require(
        spans_opposite_sides(paths[spangram_idx], rows, cols),
        f"spangram words[{spangram_idx}] must touch two opposite sides of the grid",
    )

    expected_id = compute_strands_puzzle_id(payload)
    _require(
        payload["puzzle_id"] == expected_id,
        f"puzzle_id does not match content hash {expected_id}",
    )


def write_strands_puzzle_atomic(target_path: Path, payload: dict[str, Any]) -> bytes:
    """Validate and atomically write a Strands puzzle JSON file."""
    return write_json_atomic(target_path, payload, validate_strands_puzzle)
