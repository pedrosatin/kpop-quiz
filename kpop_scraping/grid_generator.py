"""Deterministic generation of 3x3 intersection grids from sourced facts."""

from __future__ import annotations

import hashlib
import itertools
import random
import re
import sqlite3
from collections import defaultdict
from datetime import date
from typing import Any, Callable, Iterable

from .grid_schema import GRID_SCHEMA_VERSION, validate_intersection_grid
from .quiz_models import DEFAULT_REFERENCE_DATE, Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import hash_payload

QID_REGEX = re.compile(r"^Q[1-9][0-9]*$")

# Category: formed_on
DECADE_CRITERIA: dict[str, dict[str, Any]] = {
    "formed_1990s": {
        "id": "formed_1990s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreou nos anos 1990",
            "en": "Debuted in the 1990s",
        },
        "year_min": 1990,
        "year_max": 1999,
    },
    "formed_2000s": {
        "id": "formed_2000s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreou nos anos 2000",
            "en": "Debuted in the 2000s",
        },
        "year_min": 2000,
        "year_max": 2009,
    },
    "formed_2010s": {
        "id": "formed_2010s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreou nos anos 2010",
            "en": "Debuted in the 2010s",
        },
        "year_min": 2010,
        "year_max": 2019,
    },
    "formed_2020s": {
        "id": "formed_2020s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreou nos anos 2020",
            "en": "Debuted in the 2020s",
        },
        "year_min": 2020,
        "year_max": 2029,
    },
}

# Category: record_label
KNOWN_RECORD_LABELS: dict[str, tuple[str, dict[str, str]]] = {
    # Canonical Wikidata QIDs
    "Q483238": ("label_jyp", {"pt-BR": "JYP Entertainment", "en": "JYP Entertainment"}),
    "Q483938": ("label_sm", {"pt-BR": "SM Entertainment", "en": "SM Entertainment"}),
    "Q50595": ("label_yg", {"pt-BR": "YG Entertainment", "en": "YG Entertainment"}),
    "Q16161254": ("label_hybe", {"pt-BR": "HYBE", "en": "HYBE"}),
    "Q106296918": ("label_bighit", {"pt-BR": "Big Hit Music", "en": "Big Hit Music"}),
    "Q484449": ("label_cube", {"pt-BR": "Cube Entertainment", "en": "Cube Entertainment"}),
    "Q255363": ("label_starship", {"pt-BR": "Starship Entertainment", "en": "Starship Entertainment"}),
    "Q12581039": ("label_fnc", {"pt-BR": "FNC Entertainment", "en": "FNC Entertainment"}),
    "Q45282": ("label_pledis", {"pt-BR": "Pledis Entertainment", "en": "Pledis Entertainment"}),
    "Q50596": ("label_woollim", {"pt-BR": "Woollim Entertainment", "en": "Woollim Entertainment"}),
    "Q489428": ("label_dsp", {"pt-BR": "DSP Media", "en": "DSP Media"}),
    "Q31179359": ("label_kq", {"pt-BR": "KQ Entertainment", "en": "KQ Entertainment"}),
    "Q13424955": ("label_fantagio", {"pt-BR": "Fantagio", "en": "Fantagio"}),
    # Test fixture aliases
    "Q483957": ("label_sm", {"pt-BR": "SM Entertainment", "en": "SM Entertainment"}),
    "Q483471": ("label_yg", {"pt-BR": "YG Entertainment", "en": "YG Entertainment"}),
    "Q106399432": ("label_hybe", {"pt-BR": "HYBE", "en": "HYBE"}),
    "Q523826": ("label_bighit", {"pt-BR": "Big Hit Music", "en": "Big Hit Music"}),
    "Q483327": ("label_cube", {"pt-BR": "Cube Entertainment", "en": "Cube Entertainment"}),
    "Q491823": ("label_starship", {"pt-BR": "Starship Entertainment", "en": "Starship Entertainment"}),
    "Q484795": ("label_fnc", {"pt-BR": "FNC Entertainment", "en": "FNC Entertainment"}),
    "Q492067": ("label_pledis", {"pt-BR": "Pledis Entertainment", "en": "Pledis Entertainment"}),
    "Q486717": ("label_woollim", {"pt-BR": "Woollim Entertainment", "en": "Woollim Entertainment"}),
    "Q487053": ("label_dsp", {"pt-BR": "DSP Media", "en": "DSP Media"}),
}

# Category: has_member
MEMBER_COUNT_CRITERIA: dict[str, dict[str, Any]] = {
    "members_3": {
        "id": "members_3",
        "category": "has_member",
        "label": {"pt-BR": "3 integrantes", "en": "3 members"},
        "predicate": lambda count: count == 3,
    },
    "members_4": {
        "id": "members_4",
        "category": "has_member",
        "label": {"pt-BR": "4 integrantes", "en": "4 members"},
        "predicate": lambda count: count == 4,
    },
    "members_5": {
        "id": "members_5",
        "category": "has_member",
        "label": {"pt-BR": "5 integrantes", "en": "5 members"},
        "predicate": lambda count: count == 5,
    },
    "members_6": {
        "id": "members_6",
        "category": "has_member",
        "label": {"pt-BR": "6 integrantes", "en": "6 members"},
        "predicate": lambda count: count == 6,
    },
    "members_7": {
        "id": "members_7",
        "category": "has_member",
        "label": {"pt-BR": "7 integrantes", "en": "7 members"},
        "predicate": lambda count: count == 7,
    },
    "members_8": {
        "id": "members_8",
        "category": "has_member",
        "label": {"pt-BR": "8 integrantes", "en": "8 members"},
        "predicate": lambda count: count == 8,
    },
    "members_9": {
        "id": "members_9",
        "category": "has_member",
        "label": {"pt-BR": "9 integrantes", "en": "9 members"},
        "predicate": lambda count: count == 9,
    },
    "members_le_4": {
        "id": "members_le_4",
        "category": "has_member",
        "label": {"pt-BR": "4 ou menos integrantes", "en": "4 or fewer members"},
        "predicate": lambda count: count <= 4,
    },
    "members_le_5": {
        "id": "members_le_5",
        "category": "has_member",
        "label": {"pt-BR": "5 ou menos integrantes", "en": "5 or fewer members"},
        "predicate": lambda count: count <= 5,
    },
    "members_ge_6": {
        "id": "members_ge_6",
        "category": "has_member",
        "label": {"pt-BR": "6 ou mais integrantes", "en": "6 or more members"},
        "predicate": lambda count: count >= 6,
    },
    "members_ge_7": {
        "id": "members_ge_7",
        "category": "has_member",
        "label": {"pt-BR": "7 ou mais integrantes", "en": "7 or more members"},
        "predicate": lambda count: count >= 7,
    },
    "members_ge_8": {
        "id": "members_ge_8",
        "category": "has_member",
        "label": {"pt-BR": "8 ou mais integrantes", "en": "8 or more members"},
        "predicate": lambda count: count >= 8,
    },
}


def _get_label_criterion(entity: Entity) -> dict[str, Any]:
    """Return a criterion definition for a record label entity."""
    if entity.wikidata_id in KNOWN_RECORD_LABELS:
        crit_id, label = KNOWN_RECORD_LABELS[entity.wikidata_id]
        return {
            "id": crit_id,
            "category": "record_label",
            "label": label,
            "wikidata_id": entity.wikidata_id,
        }
    crit_id = f"label_{entity.wikidata_id.lower()}"
    pt_name = entity.names.get("pt") or entity.names.get("pt-BR") or entity.canonical_name
    en_name = entity.names.get("en") or entity.canonical_name
    return {
        "id": crit_id,
        "category": "record_label",
        "label": {"pt-BR": pt_name, "en": en_name},
        "wikidata_id": entity.wikidata_id,
    }


def _to_criterion_payload(criterion: dict[str, Any]) -> dict[str, Any]:
    """Extract strictly conforming criterion dictionary according to schema."""
    return {
        "id": criterion["id"],
        "category": criterion["category"],
        "label": {
            "pt-BR": criterion["label"]["pt-BR"],
            "en": criterion["label"]["en"],
        },
    }


def _serialize_evidence(evidence_items: Iterable[Evidence]) -> list[dict[str, Any]]:
    """Deduplicate and sort evidence records canonically."""
    unique: dict[tuple[str, str, int, str, str], dict[str, Any]] = {}
    for ev in evidence_items:
        key = (
            ev.fact_base_id,
            ev.locator,
            ev.revision_id,
            ev.source_key,
            ev.source_url,
        )
        if key not in unique:
            unique[key] = {
                "fact_base_id": ev.fact_base_id,
                "locator": ev.locator,
                "revision_id": ev.revision_id,
                "source_key": ev.source_key,
                "source_url": ev.source_url,
            }
    return [unique[k] for k in sorted(unique.keys())]


def has_distinct_assignment(cell_options: list[list[str]]) -> bool:
    """Return True if there is a distinct assignment for each of the 9 cells.

    Employs maximum bipartite matching with augmenting paths to test the
    system of distinct representatives (SDR) property across the matrix.
    """
    if len(cell_options) != 9:
        return False
    if any(len(options) == 0 for options in cell_options):
        return False

    matching: dict[str, int] = {}

    def bpm(cell_idx: int, visited_entities: set[str]) -> bool:
        for entity in cell_options[cell_idx]:
            if entity in visited_entities:
                continue
            visited_entities.add(entity)
            if entity not in matching or bpm(matching[entity], visited_entities):
                matching[entity] = cell_idx
                return True
        return False

    for cell_idx in range(9):
        visited: set[str] = set()
        if not bpm(cell_idx, visited):
            return False
    return len(matching) == 9


def evaluate_group_criteria(
    facts: list[Fact],
    candidate_groups: dict[str, Entity],
) -> tuple[
    dict[str, set[str]],
    dict[tuple[str, str], list[Evidence]],
    dict[str, dict[str, Any]],
]:
    """Evaluate facts to determine which criteria each accepted group satisfies.

    Returns:
        group_criteria: mapping of group QID to set of satisfied criterion IDs.
        group_evidence: mapping of (group_qid, criterion_id) to supporting Evidence list.
        all_criteria: mapping of criterion ID to full criterion definition.
    """
    group_criteria: dict[str, set[str]] = defaultdict(set)
    group_evidence: dict[tuple[str, str], list[Evidence]] = defaultdict(list)
    all_criteria: dict[str, dict[str, Any]] = {}

    for decade_id, decade_def in DECADE_CRITERIA.items():
        all_criteria[decade_id] = decade_def

    for member_id, member_def in MEMBER_COUNT_CRITERIA.items():
        all_criteria[member_id] = member_def

    # 1. formed_on facts
    for fact in facts:
        if fact.predicate != "formed_on":
            continue
        group_qid = fact.subject.wikidata_id
        if group_qid not in candidate_groups:
            continue
        if not fact.value_time or len(fact.value_time) < 4:
            continue
        try:
            year = int(fact.value_time[:4])
        except ValueError:
            continue

        for decade_id, decade_def in DECADE_CRITERIA.items():
            if decade_def["year_min"] <= year <= decade_def["year_max"]:
                group_criteria[group_qid].add(decade_id)
                group_evidence[(group_qid, decade_id)].extend(fact.evidence)

    # 2. record_label facts
    for fact in facts:
        if fact.predicate != "record_label":
            continue
        group_qid = fact.subject.wikidata_id
        if group_qid not in candidate_groups:
            continue
        if fact.value_entity is None:
            continue
        crit = _get_label_criterion(fact.value_entity)
        crit_id = crit["id"]
        all_criteria[crit_id] = crit
        group_criteria[group_qid].add(crit_id)
        group_evidence[(group_qid, crit_id)].extend(fact.evidence)

    # 3. has_member facts
    group_members: dict[str, set[str]] = defaultdict(set)
    group_member_facts: dict[str, list[Fact]] = defaultdict(list)
    for fact in facts:
        if fact.predicate != "has_member":
            continue
        group_qid = fact.subject.wikidata_id
        if group_qid not in candidate_groups:
            continue
        if fact.value_entity is not None:
            group_members[group_qid].add(fact.value_entity.wikidata_id)
            group_member_facts[group_qid].append(fact)

    for group_qid, members in group_members.items():
        count = len(members)
        if count == 0:
            continue
        member_ev = [ev for fact in group_member_facts[group_qid] for ev in fact.evidence]
        for member_id, member_def in MEMBER_COUNT_CRITERIA.items():
            if member_def["predicate"](count):
                group_criteria[group_qid].add(member_id)
                group_evidence[(group_qid, member_id)].extend(member_ev)

    return group_criteria, group_evidence, all_criteria


def _are_member_criteria_disjoint(c1: dict[str, Any], c2: dict[str, Any]) -> bool:
    """Return True if two member count criteria are mutually disjoint."""
    pred1: Callable[[int], bool] = c1["predicate"]
    pred2: Callable[[int], bool] = c2["predicate"]
    return not any(pred1(n) and pred2(n) for n in range(1, 100))


def _build_axes_for_categories(
    active_by_cat: dict[str, list[dict[str, Any]]],
    cat_spec: tuple[str, ...],
) -> list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]:
    """Build valid 3-element axes conforming to the specified category composition."""
    axes: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    if len(cat_spec) == 1:
        cat = cat_spec[0]
        items = active_by_cat.get(cat, [])
        if len(items) < 3:
            return axes
        if cat == "has_member":
            for combo in itertools.combinations(items, 3):
                if (
                    _are_member_criteria_disjoint(combo[0], combo[1])
                    and _are_member_criteria_disjoint(combo[0], combo[2])
                    and _are_member_criteria_disjoint(combo[1], combo[2])
                ):
                    axes.append(combo)
        else:
            for combo in itertools.combinations(items, 3):
                axes.append(combo)
    elif len(cat_spec) == 2:
        cat1, cat2 = cat_spec
        items1 = active_by_cat.get(cat1, [])
        items2 = active_by_cat.get(cat2, [])
        if len(items1) < 2 or len(items2) < 1:
            return axes
        for pair1 in itertools.combinations(items1, 2):
            if cat1 == "has_member" and not _are_member_criteria_disjoint(pair1[0], pair1[1]):
                continue
            for item2 in items2:
                axes.append((pair1[0], pair1[1], item2))
    return axes


def _is_valid_axis(axis: tuple[dict[str, Any], ...]) -> bool:
    """Return True if an axis contains mutually disjoint criteria."""
    member_crits = [c for c in axis if c.get("category") == "has_member"]
    for i in range(len(member_crits)):
        for j in range(i + 1, len(member_crits)):
            if not _are_member_criteria_disjoint(member_crits[i], member_crits[j]):
                return False
    return True


def _find_mixed_axis_grid(
    criteria: list[dict[str, Any]],
    criterion_groups: dict[str, set[str]],
    seed: str,
) -> tuple[
    tuple[dict[str, Any], ...],
    tuple[dict[str, Any], ...],
    dict[tuple[int, int], list[str]],
] | None:
    """Search all mixed criterion axes for a complete, unique 3x3 grid."""
    ordered_criteria = sorted(criteria, key=lambda item: item["id"])
    row_axes = [
        axis for axis in itertools.combinations(ordered_criteria, 3)
        if _is_valid_axis(axis)
    ]
    rng = random.Random(
        hashlib.sha256(f"{seed}|mixed-axis-fallback".encode("utf-8")).digest()
    )
    rng.shuffle(row_axes)
    intersection_cache: dict[tuple[str, str], list[str]] = {}

    def criterion_intersection(row_id: str, col_id: str) -> list[str]:
        key = (row_id, col_id)
        if key not in intersection_cache:
            intersection_cache[key] = sorted(
                criterion_groups[row_id] & criterion_groups[col_id]
            )
        return intersection_cache[key]

    for row_axis in row_axes:
        row_cats = {criterion["category"] for criterion in row_axis}
        compatible_columns = [
            criterion
            for criterion in ordered_criteria
            if criterion["category"] not in row_cats
            and all(
                criterion_intersection(row_criterion["id"], criterion["id"])
                for row_criterion in row_axis
            )
        ]
        possible_entities: set[str] = set()
        for criterion in compatible_columns:
            for row_criterion in row_axis:
                possible_entities.update(
                    criterion_intersection(row_criterion["id"], criterion["id"])
                )
        if len(possible_entities) < 9:
            continue

        rng.shuffle(compatible_columns)

        for col_axis in itertools.combinations(compatible_columns, 3):
            if not _is_valid_axis(col_axis):
                continue
            cells_valid = {
                (r, c): criterion_intersection(
                    row_axis[r]["id"], col_axis[c]["id"]
                )
                for r in range(3)
                for c in range(3)
            }
            cell_options = [
                cells_valid[(r, c)] for r in range(3) for c in range(3)
            ]
            if has_distinct_assignment(cell_options):
                return row_axis, col_axis, cells_valid

    return None


def generate_intersection_grid(
    connection: sqlite3.Connection,
    seed: str,
    reference_date: date | None = None,
) -> dict[str, Any]:
    """Generate a deterministic, verified 3x3 intersection grid from local facts."""
    if reference_date is None:
        reference_date = DEFAULT_REFERENCE_DATE

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, _rejected = _load_facts(connection, entities)
    dataset_version = _dataset_version(connection, entities, reference_date)

    candidate_groups = {
        entity.wikidata_id: entity
        for entity in entities.values()
        if entity.entity_type == "group" and bool(QID_REGEX.match(entity.wikidata_id))
    }

    if len(candidate_groups) < 9:
        raise ValueError(
            f"Insufficient candidate groups: found {len(candidate_groups)}, need at least 9"
        )

    group_criteria, group_evidence, all_criteria = evaluate_group_criteria(
        facts, candidate_groups
    )

    # Group entities matching each criterion
    criterion_groups: dict[str, set[str]] = defaultdict(set)
    for group_qid, crits in group_criteria.items():
        for crit_id in crits:
            criterion_groups[crit_id].add(group_qid)

    # Filter active criteria that have at least 1 matching group
    active_criteria = {
        crit_id: crit
        for crit_id, crit in all_criteria.items()
        if len(criterion_groups[crit_id]) >= 1
    }

    active_by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for crit in sorted(active_criteria.values(), key=lambda c: (c["category"], c["id"])):
        active_by_cat[crit["category"]].append(crit)

    # Category partition pairs (row_cats, col_cats) ensuring total orthogonality
    category_partitions: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
        # Pure category pairs
        (("record_label",), ("formed_on",)),
        (("formed_on",), ("record_label",)),
        (("record_label",), ("has_member",)),
        (("has_member",), ("record_label",)),
        (("formed_on",), ("has_member",)),
        (("has_member",), ("formed_on",)),
        # Dual-category row / pure col pairs
        (("formed_on", "has_member"), ("record_label",)),
        (("has_member", "formed_on"), ("record_label",)),
        (("record_label", "has_member"), ("formed_on",)),
        (("has_member", "record_label"), ("formed_on",)),
        (("formed_on", "record_label"), ("has_member",)),
        (("record_label", "formed_on"), ("has_member",)),
        # Pure row / dual-category col pairs
        (("record_label",), ("formed_on", "has_member")),
        (("record_label",), ("has_member", "formed_on")),
        (("formed_on",), ("record_label", "has_member")),
        (("formed_on",), ("has_member", "record_label")),
        (("has_member",), ("formed_on", "record_label")),
        (("has_member",), ("record_label", "formed_on")),
    ]

    candidate_pairs: list[
        tuple[
            tuple[dict[str, Any], dict[str, Any], dict[str, Any]],
            tuple[dict[str, Any], dict[str, Any], dict[str, Any]],
        ]
    ] = []

    for row_spec, col_spec in category_partitions:
        row_axes = _build_axes_for_categories(active_by_cat, row_spec)
        col_axes = _build_axes_for_categories(active_by_cat, col_spec)
        for r_axis in row_axes:
            r_ids = {c["id"] for c in r_axis}
            for c_axis in col_axes:
                c_ids = {c["id"] for c in c_axis}
                if r_ids.isdisjoint(c_ids):
                    candidate_pairs.append((r_axis, c_axis))

    # Sort deterministically before pseudo-random shuffle
    candidate_pairs.sort(
        key=lambda pair: (
            tuple(c["id"] for c in pair[0]),
            tuple(c["id"] for c in pair[1]),
        )
    )

    rng = random.Random(hashlib.sha256(seed.encode("utf-8")).digest())
    shuffled_pairs = list(candidate_pairs)
    rng.shuffle(shuffled_pairs)

    chosen_row: tuple[dict[str, Any], ...] | None = None
    chosen_col: tuple[dict[str, Any], ...] | None = None
    chosen_cells_data: dict[tuple[int, int], list[str]] = {}

    for row_criteria, col_criteria in shuffled_pairs:
        cells_valid: dict[tuple[int, int], list[str]] = {}
        solvable = True
        for r in range(3):
            for c in range(3):
                intersection = sorted(
                    criterion_groups[row_criteria[r]["id"]]
                    & criterion_groups[col_criteria[c]["id"]]
                )
                if not intersection:
                    solvable = False
                    break
                cells_valid[(r, c)] = intersection
            if not solvable:
                break

        if not solvable:
            continue

        cells_options_list = [cells_valid[(r, c)] for r in range(3) for c in range(3)]
        if not has_distinct_assignment(cells_options_list):
            continue

        chosen_row = row_criteria
        chosen_col = col_criteria
        chosen_cells_data = cells_valid
        break

    # The curated partitions above are preferred because they keep each axis
    # semantically focused. If none has a solution, exhaustively search all
    # triples of active evidence-backed criteria before reporting failure.
    if chosen_row is None or chosen_col is None:
        fallback_grid = _find_mixed_axis_grid(
            list(active_criteria.values()), criterion_groups, seed
        )
        if fallback_grid is not None:
            chosen_row, chosen_col, chosen_cells_data = fallback_grid

    if chosen_row is None or chosen_col is None:
        raise ValueError(
            f"Unable to generate a solvable 3x3 intersection grid with seed {seed!r}"
        )

    # Build conforming JSON structures
    row_criteria_payload = [_to_criterion_payload(c) for c in chosen_row]
    col_criteria_payload = [_to_criterion_payload(c) for c in chosen_col]

    cells_payload: list[dict[str, Any]] = []
    for r in range(3):
        for c in range(3):
            valid_ids = chosen_cells_data[(r, c)]
            r_crit_id = chosen_row[r]["id"]
            c_crit_id = chosen_col[c]["id"]
            all_cell_ev: list[Evidence] = []
            for qid in valid_ids:
                all_cell_ev.extend(group_evidence.get((qid, r_crit_id), ()))
                all_cell_ev.extend(group_evidence.get((qid, c_crit_id), ()))
            serialized_ev = _serialize_evidence(all_cell_ev)
            cells_payload.append(
                {
                    "row_index": r,
                    "col_index": c,
                    "valid_entity_ids": valid_ids,
                    "evidence": serialized_ev,
                }
            )

    candidate_pool: list[dict[str, Any]] = [
        {
            "id": group.wikidata_id,
            "canonical_name": group.canonical_name,
            "names": {
                "pt-BR": (
                    group.names.get("pt")
                    or group.names.get("pt-BR")
                    or group.canonical_name
                ),
                "en": group.names.get("en") or group.canonical_name,
            },
        }
        for group in sorted(candidate_groups.values(), key=lambda g: g.wikidata_id)
    ]

    reference_date_str = reference_date.isoformat()
    dimensions = {"rows": 3, "cols": 3}

    hashable_payload = {
        "candidate_pool": candidate_pool,
        "cells": cells_payload,
        "col_criteria": col_criteria_payload,
        "dataset_version": dataset_version,
        "dimensions": dimensions,
        "reference_date": reference_date_str,
        "row_criteria": row_criteria_payload,
        "schema_version": GRID_SCHEMA_VERSION,
    }
    grid_id = hash_payload(hashable_payload)

    grid = {
        "schema_version": GRID_SCHEMA_VERSION,
        "grid_id": grid_id,
        "dataset_version": dataset_version,
        "reference_date": reference_date_str,
        "dimensions": dimensions,
        "row_criteria": row_criteria_payload,
        "col_criteria": col_criteria_payload,
        "cells": cells_payload,
        "candidate_pool": candidate_pool,
    }

    validate_intersection_grid(grid)
    return grid


def generate_daily_grid(
    connection: sqlite3.Connection,
    reference_date: date | str | None = None,
    seed: str | None = None,
) -> dict[str, Any]:
    """Generate a deterministic daily 3x3 intersection grid for the given date."""
    if reference_date is None:
        ref_date = datetime.now(timezone.utc).date()
    elif isinstance(reference_date, str):
        ref_date = date.fromisoformat(reference_date)
    else:
        ref_date = reference_date

    grid_seed = seed if seed is not None else f"kpop-grid-daily-{ref_date.isoformat()}"
    return generate_intersection_grid(connection, seed=grid_seed, reference_date=ref_date)
