"""Schema checks and validation for intersection grid artifacts."""

from __future__ import annotations

import os
import re
import tempfile
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .storage import canonical_json

GRID_SCHEMA_VERSION = "kpop-intersection-grid-v1"
GRID_CATEGORIES = frozenset({"formed_on", "record_label", "has_member"})

GRID_ROOT_FIELDS = frozenset(
    {
        "schema_version",
        "grid_id",
        "dataset_version",
        "reference_date",
        "dimensions",
        "row_criteria",
        "col_criteria",
        "cells",
        "candidate_pool",
    }
)

CRITERION_FIELDS = frozenset({"id", "category", "label"})
BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
DIMENSIONS_FIELDS = frozenset({"rows", "cols"})
CELL_FIELDS = frozenset({"row_index", "col_index", "valid_entity_ids", "evidence"})
CANDIDATE_FIELDS = frozenset({"id", "canonical_name", "names"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid grid schema: {message}")


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
        raise ValueError(f"Invalid grid schema: {field_name} is not a calendar date") from exc


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
        isinstance(evidence["revision_id"], int) and evidence["revision_id"] >= 1,
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


def _validate_criterion(criterion: Any, context: str) -> None:
    _require(isinstance(criterion, dict), f"{context} must be an object")
    _require(
        set(criterion.keys()) == CRITERION_FIELDS,
        f"{context} contains unexpected or missing fields",
    )
    _require(
        isinstance(criterion["id"], str) and len(criterion["id"]) > 0,
        f"{context}.id must be a non-empty string",
    )
    _require(
        criterion["category"] in GRID_CATEGORIES,
        f"{context}.category must be one of {sorted(GRID_CATEGORIES)}",
    )
    _require_bilingual_text(criterion["label"], f"{context}.label")


def _validate_candidate(candidate: Any, context: str) -> None:
    _require(isinstance(candidate, dict), f"{context} must be an object")
    _require(
        set(candidate.keys()) == CANDIDATE_FIELDS,
        f"{context} contains unexpected or missing fields",
    )
    _require_qid(candidate["id"], f"{context}.id")
    _require(
        isinstance(candidate["canonical_name"], str) and len(candidate["canonical_name"]) > 0,
        f"{context}.canonical_name must be a non-empty string",
    )
    _require_bilingual_text(candidate["names"], f"{context}.names")


def validate_intersection_grid(payload: dict[str, Any]) -> None:
    """Validate that payload conforms to intersection-grid-v1 specification.

    Raises ValueError when the payload is invalid.
    """
    _require(isinstance(payload, dict), "root payload must be an object")
    _require(
        set(payload.keys()) == GRID_ROOT_FIELDS,
        f"root payload has missing or extra fields: {sorted(set(payload.keys()) ^ GRID_ROOT_FIELDS)}",
    )
    _require(payload["schema_version"] == GRID_SCHEMA_VERSION, "schema_version must match")
    _require_hash(payload["grid_id"], "grid_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")

    # Dimensions
    dimensions = payload["dimensions"]
    _require(isinstance(dimensions, dict), "dimensions must be an object")
    _require(set(dimensions.keys()) == DIMENSIONS_FIELDS, "dimensions fields must be rows and cols")
    _require(dimensions["rows"] == 3, "dimensions.rows must be 3")
    _require(dimensions["cols"] == 3, "dimensions.cols must be 3")

    # Row criteria
    row_criteria = payload["row_criteria"]
    _require(isinstance(row_criteria, list), "row_criteria must be a list")
    _require(len(row_criteria) == 3, "row_criteria must have exactly 3 items")
    row_ids: set[str] = set()
    for idx, crit in enumerate(row_criteria):
        _validate_criterion(crit, f"row_criteria[{idx}]")
        _require(crit["id"] not in row_ids, f"duplicate row criterion id: {crit['id']}")
        row_ids.add(crit["id"])

    # Column criteria
    col_criteria = payload["col_criteria"]
    _require(isinstance(col_criteria, list), "col_criteria must be a list")
    _require(len(col_criteria) == 3, "col_criteria must have exactly 3 items")
    col_ids: set[str] = set()
    for idx, crit in enumerate(col_criteria):
        _validate_criterion(crit, f"col_criteria[{idx}]")
        _require(crit["id"] not in col_ids, f"duplicate col criterion id: {crit['id']}")
        col_ids.add(crit["id"])

    # Candidate pool
    candidate_pool = payload["candidate_pool"]
    _require(isinstance(candidate_pool, list), "candidate_pool must be a list")
    _require(len(candidate_pool) >= 1, "candidate_pool must not be empty")
    candidate_qids: set[str] = set()
    for idx, cand in enumerate(candidate_pool):
        _validate_candidate(cand, f"candidate_pool[{idx}]")
        _require(cand["id"] not in candidate_qids, f"duplicate candidate id: {cand['id']}")
        candidate_qids.add(cand["id"])

    # Cells
    cells = payload["cells"]
    _require(isinstance(cells, list), "cells must be a list")
    _require(len(cells) == 9, "cells must contain exactly 9 cells")
    seen_coords: set[tuple[int, int]] = set()

    for idx, cell in enumerate(cells):
        _require(isinstance(cell, dict), f"cells[{idx}] must be an object")
        _require(
            set(cell.keys()) == CELL_FIELDS,
            f"cells[{idx}] has missing or extra fields",
        )
        r_idx = cell["row_index"]
        c_idx = cell["col_index"]
        _require(isinstance(r_idx, int) and 0 <= r_idx <= 2, f"cells[{idx}].row_index must be 0, 1, or 2")
        _require(isinstance(c_idx, int) and 0 <= c_idx <= 2, f"cells[{idx}].col_index must be 0, 1, or 2")
        coord = (r_idx, c_idx)
        _require(coord not in seen_coords, f"duplicate cell coordinate: {coord}")
        seen_coords.add(coord)

        valid_entities = cell["valid_entity_ids"]
        _require(isinstance(valid_entities, list), f"cells[{idx}].valid_entity_ids must be a list")
        _require(len(valid_entities) >= 1, f"cells[{idx}].valid_entity_ids must not be empty")
        _require(
            len(valid_entities) == len(set(valid_entities)),
            f"cells[{idx}].valid_entity_ids contains duplicates",
        )
        for entity_idx, qid in enumerate(valid_entities):
            _require_qid(qid, f"cells[{idx}].valid_entity_ids[{entity_idx}]")

        evidence_list = cell["evidence"]
        _require(isinstance(evidence_list, list), f"cells[{idx}].evidence must be a list")
        _require(len(evidence_list) >= 1, f"cells[{idx}].evidence must not be empty")
        for ev_idx, ev in enumerate(evidence_list):
            _validate_evidence(ev, f"cells[{idx}].evidence[{ev_idx}]")

    expected_coords = {(r, c) for r in range(3) for c in range(3)}
    _require(seen_coords == expected_coords, "cells must cover all 9 positions (0..2, 0..2)")


def write_intersection_grid_atomic(target_path: Path, payload: dict[str, Any]) -> None:
    """Validate and atomically write an intersection grid JSON file."""
    validate_intersection_grid(payload)
    target_path = target_path.resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    payload_bytes = canonical_json(payload)
    temp_file = tempfile.NamedTemporaryFile(
        mode="wb",
        dir=target_path.parent,
        prefix=f"{target_path.name}.",
        delete=False,
    )
    try:
        temp_file.write(payload_bytes)
        temp_file.flush()
        os.fsync(temp_file.fileno())
        temp_file.close()
        os.replace(temp_file.name, target_path)
    except Exception:
        if os.path.exists(temp_file.name):
            os.remove(temp_file.name)
        raise
