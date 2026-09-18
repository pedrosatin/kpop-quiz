"""Deterministic generation of 4x4 connections puzzles from audited facts."""

from __future__ import annotations

import itertools
import random
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .connections_schema import CONNECTIONS_SCHEMA_VERSION, validate_connections_puzzle
from .quiz_models import Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import hash_payload

QID_REGEX = re.compile(r"^Q[1-9][0-9]*$")

# Category definitions for debut decades
DECADE_CRITERIA: dict[str, dict[str, Any]] = {
    "formed_1990s": {
        "id": "formed_1990s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreia nos anos 1990",
            "en": "Debuted in the 1990s",
        },
        "explanation": {
            "pt-BR": "Todos os quatro grupos estrearam na década de 1990.",
            "en": "All four groups debuted in the 1990s.",
        },
        "year_min": 1990,
        "year_max": 1999,
    },
    "formed_2000s": {
        "id": "formed_2000s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreia nos anos 2000",
            "en": "Debuted in the 2000s",
        },
        "explanation": {
            "pt-BR": "Todos os quatro grupos estrearam na década de 2000.",
            "en": "All four groups debuted in the 2000s.",
        },
        "year_min": 2000,
        "year_max": 2009,
    },
    "formed_2010s": {
        "id": "formed_2010s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreia nos anos 2010",
            "en": "Debuted in the 2010s",
        },
        "explanation": {
            "pt-BR": "Todos os quatro grupos estrearam na década de 2010.",
            "en": "All four groups debuted in the 2010s.",
        },
        "year_min": 2010,
        "year_max": 2019,
    },
    "formed_2020s": {
        "id": "formed_2020s",
        "category": "formed_on",
        "label": {
            "pt-BR": "Estreia nos anos 2020",
            "en": "Debuted in the 2020s",
        },
        "explanation": {
            "pt-BR": "Todos os quatro grupos estrearam na década de 2020.",
            "en": "All four groups debuted in the 2020s.",
        },
        "year_min": 2020,
        "year_max": 2029,
    },
}

# Known record labels with normalized bilingual labels
KNOWN_RECORD_LABELS: dict[str, tuple[str, dict[str, str]]] = {
    "Q483238": ("label_jyp", {"pt-BR": "JYP Entertainment", "en": "JYP Entertainment"}),
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

# Category definitions for exact member counts (3 to 9 members)
MEMBER_COUNT_CRITERIA: dict[int, dict[str, Any]] = {
    n: {
        "id": f"members_{n}",
        "category": "has_member",
        "label": {
            "pt-BR": f"{n} integrantes",
            "en": f"{n} members",
        },
        "explanation": {
            "pt-BR": f"Todos os quatro grupos possuem exatamente {n} integrantes.",
            "en": f"All four groups have exactly {n} members.",
        },
        "count": n,
    }
    for n in range(3, 10)
}

# Priority ordering for tie-breaking difficulty levels
CATEGORY_TYPE_ORDER = {"record_label": 1, "formed_on": 2, "has_member": 3}


def _get_record_label_criterion(entity: Entity) -> dict[str, Any]:
    """Build criterion definition for a record label entity."""
    if entity.wikidata_id in KNOWN_RECORD_LABELS:
        crit_id, label = KNOWN_RECORD_LABELS[entity.wikidata_id]
        pt_name = label["pt-BR"]
        en_name = label["en"]
    else:
        crit_id = f"label_{entity.wikidata_id.lower()}"
        pt_name = entity.names.get("pt") or entity.names.get("pt-BR") or entity.canonical_name
        en_name = entity.names.get("en") or entity.canonical_name

    return {
        "id": crit_id,
        "category": "record_label",
        "label": {
            "pt-BR": pt_name,
            "en": en_name,
        },
        "explanation": {
            "pt-BR": f"Todos os quatro grupos pertencem à gravadora {pt_name}.",
            "en": f"All four groups belong to the label {en_name}.",
        },
        "wikidata_id": entity.wikidata_id,
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


def count_valid_partitions(
    candidate_items: list[str],
    categories_criteria: list[tuple[str, set[str]]],
    max_count: int = 2,
) -> int:
    """Count the number of partitions of 16 items into 4 groups of 4 matching 4 criteria.

    Terminates early when the number of valid partitions reaches max_count.
    """
    if len(candidate_items) != 16 or len(set(candidate_items)) != 16:
        return 0
    if len(categories_criteria) != 4:
        return 0
    if len({cat_id for cat_id, _ in categories_criteria}) != 4:
        return 0
    if max_count <= 0:
        return 0

    pool = set(candidate_items)
    item_to_bit = {item: 1 << idx for idx, item in enumerate(candidate_items)}

    criterion_combos: list[list[int]] = []
    for _cat_id, valid_set in categories_criteria:
        matching = [item for item in valid_set if item in pool]
        if len(matching) < 4:
            return 0
        combos = [
            sum(item_to_bit[item] for item in quad)
            for quad in itertools.combinations(matching, 4)
        ]
        criterion_combos.append(combos)

    # Sort criteria by number of combinations to prune search branches early
    sorted_order = sorted(range(4), key=lambda idx: len(criterion_combos[idx]))
    c0 = criterion_combos[sorted_order[0]]
    c1 = criterion_combos[sorted_order[1]]
    c2 = criterion_combos[sorted_order[2]]
    c3_set = set(criterion_combos[sorted_order[3]])

    full_mask = 0xFFFF
    seen_partitions: set[frozenset[int]] = set()

    for m0 in c0:
        for m1 in c1:
            if m1 & m0:
                continue
            m01 = m0 | m1
            for m2 in c2:
                if m2 & m01:
                    continue
                m3 = full_mask ^ (m01 | m2)
                if m3 in c3_set:
                    seen_partitions.add(frozenset((m0, m1, m2, m3)))
                    if len(seen_partitions) >= max_count:
                        return len(seen_partitions)

    return len(seen_partitions)


def evaluate_connections_criteria(
    facts: list[Fact],
    candidate_groups: dict[str, Entity],
) -> tuple[
    dict[str, set[str]],
    dict[tuple[str, str], list[Evidence]],
    dict[str, dict[str, Any]],
]:
    """Evaluate facts to determine satisfied criteria for each candidate group."""
    group_criteria: dict[str, set[str]] = defaultdict(set)
    group_evidence: dict[tuple[str, str], list[Evidence]] = defaultdict(list)
    all_criteria: dict[str, dict[str, Any]] = {}

    for decade_id, decade_def in DECADE_CRITERIA.items():
        all_criteria[decade_id] = decade_def

    for member_crit in MEMBER_COUNT_CRITERIA.values():
        all_criteria[member_crit["id"]] = member_crit

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
        crit = _get_record_label_criterion(fact.value_entity)
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
        if count in MEMBER_COUNT_CRITERIA:
            member_crit = MEMBER_COUNT_CRITERIA[count]
            crit_id = member_crit["id"]
            group_criteria[group_qid].add(crit_id)
            member_ev = [ev for f in group_member_facts[group_qid] for ev in f.evidence]
            group_evidence[(group_qid, crit_id)].extend(member_ev)

    return group_criteria, group_evidence, all_criteria


def _rank_difficulty(
    chosen_categories: tuple[str, ...],
    assignment: dict[str, tuple[str, ...]],
    candidate_items: list[str],
    criterion_groups: dict[str, set[str]],
    all_criteria: dict[str, dict[str, Any]],
) -> list[str]:
    """Sort categories from easiest (level 1) to hardest (level 4)."""
    pool_set = set(candidate_items)

    def sort_key(cat_id: str) -> tuple[int, int, int, str]:
        distractors = len((criterion_groups[cat_id] & pool_set) - set(assignment[cat_id]))
        cat_type = all_criteria[cat_id]["category"]
        type_rank = CATEGORY_TYPE_ORDER.get(cat_type, 99)
        db_count = len(criterion_groups[cat_id])
        return (distractors, type_rank, -db_count, cat_id)

    return sorted(chosen_categories, key=sort_key)


def _find_disjoint_assignment(
    combo: tuple[str, ...],
    criterion_groups: dict[str, set[str]],
    rng: random.Random,
    max_evaluations: int = 40,
) -> tuple[dict[str, tuple[str, ...]], list[str]] | None:
    """Find a unique 4x4 partition assignment for the given combination of 4 criteria."""
    c0, c1, c2, c3 = combo
    s0 = criterion_groups[c0]
    s1 = criterion_groups[c1]
    s2 = criterion_groups[c2]
    s3 = criterion_groups[c3]

    if len(s0 | s1 | s2 | s3) < 16:
        return None

    ordered_cats = tuple(sorted(combo, key=lambda c: len(criterion_groups[c])))
    k0, k1, k2, k3 = ordered_cats

    combos_0 = list(itertools.combinations(sorted(criterion_groups[k0]), 4))
    rng.shuffle(combos_0)

    categories_criteria = [(c, criterion_groups[c]) for c in combo]
    eval_count = 0

    for a0 in combos_0:
        set_a0 = set(a0)
        rem_1 = [x for x in sorted(criterion_groups[k1]) if x not in set_a0]
        if len(rem_1) < 4:
            continue
        combos_1 = list(itertools.combinations(rem_1, 4))
        rng.shuffle(combos_1)

        for a1 in combos_1:
            set_a01 = set_a0 | set(a1)
            rem_2 = [x for x in sorted(criterion_groups[k2]) if x not in set_a01]
            if len(rem_2) < 4:
                continue
            combos_2 = list(itertools.combinations(rem_2, 4))
            rng.shuffle(combos_2)

            for a2 in combos_2:
                set_a012 = set_a01 | set(a2)
                rem_3 = [x for x in sorted(criterion_groups[k3]) if x not in set_a012]
                if len(rem_3) < 4:
                    continue
                combos_3 = list(itertools.combinations(rem_3, 4))
                rng.shuffle(combos_3)

                for a3 in combos_3:
                    eval_count += 1
                    candidate_16 = sorted(set_a012 | set(a3))
                    if count_valid_partitions(candidate_16, categories_criteria, max_count=2) == 1:
                        assignment = {k0: a0, k1: a1, k2: a2, k3: a3}
                        return assignment, candidate_16
                    if eval_count >= max_evaluations:
                        return None
    return None


def generate_connections_puzzle(
    connection: sqlite3.Connection,
    seed: str | None = None,
    reference_date: date | None = None,
) -> dict[str, Any]:
    """Generate a deterministic, verified 4x4 connections puzzle from local facts."""
    if reference_date is None:
        reference_date = datetime.now(timezone.utc).date()

    if seed is None:
        seed = f"kpop-connections-{reference_date.isoformat()}"

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, _rejected = _load_facts(connection, entities)
    dataset_version = _dataset_version(connection, entities, reference_date)

    candidate_groups = {
        entity.wikidata_id: entity
        for entity in sorted(entities.values(), key=lambda e: e.wikidata_id)
        if entity.entity_type == "group" and bool(QID_REGEX.match(entity.wikidata_id))
    }

    if len(candidate_groups) < 16:
        raise ValueError(
            f"Insufficient candidate groups: found {len(candidate_groups)}, need at least 16"
        )

    group_criteria, group_evidence, all_criteria = evaluate_connections_criteria(
        facts, candidate_groups
    )

    criterion_groups: dict[str, set[str]] = defaultdict(set)
    for group_qid in sorted(group_criteria.keys()):
        for crit_id in sorted(group_criteria[group_qid]):
            criterion_groups[crit_id].add(group_qid)

    # Keep criteria with at least 4 matching candidate groups
    active_criteria = {
        crit_id: all_criteria[crit_id]
        for crit_id in sorted(all_criteria.keys())
        if len(criterion_groups[crit_id]) >= 4
    }

    if len(active_criteria) < 4:
        raise ValueError(
            f"Insufficient active criteria: found {len(active_criteria)}, need at least 4"
        )

    active_crit_ids = sorted(active_criteria.keys())
    criteria_combos = list(itertools.combinations(active_crit_ids, 4))
    criteria_combos.sort()

    rng = random.Random(seed)
    shuffled_combos = list(criteria_combos)
    rng.shuffle(shuffled_combos)

    found_puzzle_data: tuple[
        tuple[str, ...],
        dict[str, tuple[str, ...]],
        list[str],
    ] | None = None

    for combo in shuffled_combos:
        c0, c1, c2, c3 = combo
        s0 = criterion_groups[c0]
        s1 = criterion_groups[c1]
        s2 = criterion_groups[c2]
        s3 = criterion_groups[c3]

        if len(s0 | s1 | s2 | s3) < 16:
            continue

        result = _find_disjoint_assignment(combo, criterion_groups, rng)
        if result is not None:
            assignment_map, candidate_items = result
            found_puzzle_data = (combo, assignment_map, candidate_items)
            break

    if found_puzzle_data is None:
        raise ValueError(
            f"Unable to generate a solvable connections puzzle with seed {seed!r}"
        )

    chosen_combo, assignment_map, candidate_items = found_puzzle_data

    # Rank categories by difficulty (levels 1, 2, 3, 4)
    ranked_cats = _rank_difficulty(
        chosen_combo,
        assignment_map,
        candidate_items,
        criterion_groups,
        all_criteria,
    )

    categories_payload: list[dict[str, Any]] = []
    for rank_idx, cat_id in enumerate(ranked_cats):
        diff_level = rank_idx + 1
        crit_def = all_criteria[cat_id]
        item_ids = sorted(assignment_map[cat_id])

        cat_evidences: list[Evidence] = []
        for qid in item_ids:
            cat_evidences.extend(group_evidence.get((qid, cat_id), ()))

        serialized_ev = _serialize_evidence(cat_evidences)
        if not serialized_ev:
            raise ValueError(f"No evidence found for category {cat_id}")

        categories_payload.append(
            {
                "id": cat_id,
                "label": {
                    "pt-BR": crit_def["label"]["pt-BR"],
                    "en": crit_def["label"]["en"],
                },
                "difficulty_level": diff_level,
                "item_ids": item_ids,
                "explanation": {
                    "pt-BR": crit_def["explanation"]["pt-BR"],
                    "en": crit_def["explanation"]["en"],
                },
                "evidence": serialized_ev,
            }
        )

    # Build and shuffle items presentation order deterministically
    items_payload: list[dict[str, Any]] = []
    for qid in sorted(candidate_items):
        group = candidate_groups[qid]
        items_payload.append(
            {
                "id": qid,
                "canonical_name": group.canonical_name,
                "labels": {
                    "pt-BR": (
                        group.names.get("pt")
                        or group.names.get("pt-BR")
                        or group.canonical_name
                    ),
                    "en": group.names.get("en") or group.canonical_name,
                },
            }
        )
    rng.shuffle(items_payload)

    reference_date_str = reference_date.isoformat()
    dimensions = {"groups": 4, "items_per_group": 4, "total_items": 16}

    hashable_payload = {
        "categories": categories_payload,
        "dataset_version": dataset_version,
        "dimensions": dimensions,
        "items": items_payload,
        "reference_date": reference_date_str,
        "schema_version": CONNECTIONS_SCHEMA_VERSION,
    }
    puzzle_id = hash_payload(hashable_payload)

    puzzle = {
        "schema_version": CONNECTIONS_SCHEMA_VERSION,
        "puzzle_id": puzzle_id,
        "dataset_version": dataset_version,
        "reference_date": reference_date_str,
        "dimensions": dimensions,
        "categories": categories_payload,
        "items": items_payload,
    }

    validate_connections_puzzle(puzzle)
    return puzzle
