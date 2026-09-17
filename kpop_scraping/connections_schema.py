"""Schema checks and validation for connections puzzle artifacts."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .quiz_schema import write_json_atomic

CONNECTIONS_SCHEMA_VERSION = "kpop-connections-puzzle-v1"

CONNECTIONS_ROOT_FIELDS = frozenset(
    {
        "schema_version",
        "puzzle_id",
        "dataset_version",
        "reference_date",
        "dimensions",
        "categories",
        "items",
    }
)

DIMENSIONS_FIELDS = frozenset({"groups", "items_per_group", "total_items"})
CATEGORY_FIELDS = frozenset({"id", "label", "difficulty_level", "item_ids", "explanation", "evidence"})
ITEM_FIELDS = frozenset({"id", "canonical_name", "labels"})
BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid connections puzzle schema: {message}")


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
            f"Invalid connections puzzle schema: {field_name} is not a calendar date"
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


def validate_connections_puzzle(payload: dict[str, Any]) -> None:
    """Validate that payload conforms to connections-puzzle-v1 specification.

    Raises ValueError when the payload is invalid.
    """
    _require(isinstance(payload, dict), "root payload must be an object")
    _require(
        set(payload.keys()) == CONNECTIONS_ROOT_FIELDS,
        f"root payload has missing or extra fields: {sorted(set(payload.keys()) ^ CONNECTIONS_ROOT_FIELDS)}",
    )
    _require(
        payload["schema_version"] == CONNECTIONS_SCHEMA_VERSION,
        f"schema_version must be {CONNECTIONS_SCHEMA_VERSION}",
    )
    _require_hash(payload["puzzle_id"], "puzzle_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")

    # Dimensions
    dimensions = payload["dimensions"]
    _require(isinstance(dimensions, dict), "dimensions must be an object")
    _require(
        set(dimensions.keys()) == DIMENSIONS_FIELDS,
        "dimensions fields must be groups, items_per_group, and total_items",
    )
    _require(
        type(dimensions["groups"]) is int and dimensions["groups"] == 4,
        "dimensions.groups must be 4",
    )
    _require(
        type(dimensions["items_per_group"]) is int and dimensions["items_per_group"] == 4,
        "dimensions.items_per_group must be 4",
    )
    _require(
        type(dimensions["total_items"]) is int and dimensions["total_items"] == 16,
        "dimensions.total_items must be 16",
    )

    # Categories
    categories = payload["categories"]
    _require(isinstance(categories, list), "categories must be a list")
    _require(len(categories) == 4, "categories must contain exactly 4 categories")

    seen_category_ids: set[str] = set()
    difficulty_levels: list[int] = []
    category_item_sets: list[set[str]] = []
    all_category_item_ids: list[str] = []

    for idx, cat in enumerate(categories):
        _require(isinstance(cat, dict), f"categories[{idx}] must be an object")
        _require(
            set(cat.keys()) == CATEGORY_FIELDS,
            f"categories[{idx}] has missing or extra fields",
        )
        _require(
            isinstance(cat["id"], str) and len(cat["id"]) > 0,
            f"categories[{idx}].id must be a non-empty string",
        )
        _require(cat["id"] not in seen_category_ids, f"duplicate category id: {cat['id']}")
        seen_category_ids.add(cat["id"])

        _require_bilingual_text(cat["label"], f"categories[{idx}].label")
        _require_bilingual_text(cat["explanation"], f"categories[{idx}].explanation")

        diff = cat["difficulty_level"]
        _require(
            type(diff) is int and 1 <= diff <= 4,
            f"categories[{idx}].difficulty_level must be an integer between 1 and 4",
        )
        difficulty_levels.append(diff)

        item_ids = cat["item_ids"]
        _require(isinstance(item_ids, list), f"categories[{idx}].item_ids must be a list")
        _require(len(item_ids) == 4, f"categories[{idx}].item_ids must contain exactly 4 items")
        _require(
            len(item_ids) == len(set(item_ids)),
            f"categories[{idx}].item_ids contains duplicate items",
        )
        for item_idx, qid in enumerate(item_ids):
            _require_qid(qid, f"categories[{idx}].item_ids[{item_idx}]")

        category_item_sets.append(set(item_ids))
        all_category_item_ids.extend(item_ids)

        ev_list = cat["evidence"]
        _require(isinstance(ev_list, list), f"categories[{idx}].evidence must be a list")
        _require(len(ev_list) >= 1, f"categories[{idx}].evidence must not be empty")
        for ev_idx, ev in enumerate(ev_list):
            _validate_evidence(ev, f"categories[{idx}].evidence[{ev_idx}]")

    _require(
        set(difficulty_levels) == {1, 2, 3, 4} and len(difficulty_levels) == 4,
        "categories must have distinct difficulty_levels spanning exactly 1, 2, 3, 4",
    )

    # Items
    items = payload["items"]
    _require(isinstance(items, list), "items must be a list")
    _require(len(items) == 16, "items must contain exactly 16 items")

    seen_item_ids: set[str] = set()
    for idx, item in enumerate(items):
        _require(isinstance(item, dict), f"items[{idx}] must be an object")
        _require(
            set(item.keys()) == ITEM_FIELDS,
            f"items[{idx}] has missing or extra fields",
        )
        _require_qid(item["id"], f"items[{idx}].id")
        _require(item["id"] not in seen_item_ids, f"duplicate item id: {item['id']}")
        seen_item_ids.add(item["id"])
        _require(
            isinstance(item["canonical_name"], str) and len(item["canonical_name"]) > 0,
            f"items[{idx}].canonical_name must be a non-empty string",
        )
        _require_bilingual_text(item["labels"], f"items[{idx}].labels")

    # Disjointness and referential integrity (perfect partition)
    for i in range(len(category_item_sets)):
        for j in range(i + 1, len(category_item_sets)):
            overlap = category_item_sets[i] & category_item_sets[j]
            _require(
                len(overlap) == 0,
                f"categories {categories[i]['id']} and {categories[j]['id']} share item(s): {sorted(overlap)}",
            )

    category_id_set = set(all_category_item_ids)
    diff_missing = category_id_set - seen_item_ids
    _require(
        not diff_missing,
        f"category item_ids not found in items pool: {sorted(diff_missing)}",
    )
    diff_unref = seen_item_ids - category_id_set
    _require(
        not diff_unref,
        f"items not referenced by any category: {sorted(diff_unref)}",
    )


def write_connections_puzzle_atomic(target_path: Path, payload: dict[str, Any]) -> bytes:
    """Validate and atomically write a connections puzzle JSON file."""
    return write_json_atomic(target_path, payload, validate_connections_puzzle)
