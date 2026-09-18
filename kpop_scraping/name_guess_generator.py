"""Deterministic generation of K-pop name guess puzzles from audited facts."""

from __future__ import annotations

import hashlib
import random
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .name_guess_schema import (
    NAME_GUESS_SCHEMA_VERSION,
    normalize_name,
    validate_name_guess_puzzle,
)
from .quiz_models import Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import hash_payload

QID_REGEX = re.compile(r"^Q[1-9][0-9]*$")

# Curated vocabulary of common K-pop names and terms to supplement valid guesses
CURATED_SUPPLEMENTAL_VOCABULARY: dict[int, list[str]] = {
    3: [
        "BTS",
        "EXO",
        "NCT",
        "CIX",
        "DIA",
        "AOA",
        "CLC",
        "GOT",
    ],
    4: [
        "KARA",
        "ITZY",
        "EXID",
        "KARD",
        "BTOB",
        "MBLAQ"[:4],
    ],
    5: [
        "TWICE",
        "AESPA",
        "STAYC",
        "LOONA",
        "FIFTY",
        "BRAVE",
        "HELLO",
        "ALICE",
        "APRIL",
        "LIGHT",
        "DREAM",
        "SHINE",
        "VIVIZ",
        "TRIBE",
        "CRAXY",
        "OMEGA",
        "JISOO",
        "CHUUU",
        "ALPHA",
    ],
    6: [
        "KEPLER",
        "SECRET",
        "PURPLE",
        "SISTAR",
        "WINNER",
        "SHINHO",
        "JENNIE",
    ],
    7: [
        "RAINBOW",
        "SHINHWA",
        "MAMAMOO",
        "ENHYPEN",
        "TEMPEST",
        "BILLLIE",
    ],
    8: [
        "NEWJEANS",
        "PENTAGON",
        "SUPERM",
    ],
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


def _extract_clues_and_evidence(
    entity: Entity,
    entity_facts: list[Fact],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Extract pedagogical clues and deduplicated evidence for a target entity."""
    all_evidence: list[Evidence] = []
    for fact in entity_facts:
        all_evidence.extend(fact.evidence)

    serialized_evidence = _serialize_evidence(all_evidence)
    if not serialized_evidence:
        raise ValueError(f"Target entity {entity.wikidata_id} has no evidence")

    debut_year: int | None = None
    agency_dict: dict[str, str] | None = None
    members_count: int | None = None

    for fact in entity_facts:
        if fact.predicate in {"formed_on", "born_on"} and fact.value_time:
            try:
                year = int(fact.value_time[:4])
                if 1900 <= year <= 2100:
                    debut_year = year
                    break
            except (ValueError, IndexError):
                pass

    for fact in entity_facts:
        if fact.predicate == "record_label" and fact.value_entity:
            val_ent = fact.value_entity
            pt_label = (
                val_ent.names.get("pt")
                or val_ent.names.get("pt-BR")
                or val_ent.canonical_name
            )
            en_label = val_ent.names.get("en") or val_ent.canonical_name
            agency_dict = {"pt-BR": pt_label, "en": en_label}
            break

    if entity.entity_type == "group":
        member_facts = [f for f in entity_facts if f.predicate == "has_member"]
        if member_facts:
            count = len(member_facts)
            if 1 <= count <= 50:
                members_count = count

    desc_pt_parts: list[str] = []
    desc_en_parts: list[str] = []

    if entity.entity_type == "group":
        if members_count is not None:
            desc_pt_parts.append(f"Grupo musical com {members_count} integrantes")
            desc_en_parts.append(f"K-pop group with {members_count} members")
        else:
            desc_pt_parts.append("Grupo musical do universo K-pop")
            desc_en_parts.append("K-pop music group")

        if debut_year is not None:
            desc_pt_parts.append(f"formado em {debut_year}")
            desc_en_parts.append(f"formed in {debut_year}")

        if agency_dict is not None:
            desc_pt_parts.append(f"pela empresa {agency_dict['pt-BR']}")
            desc_en_parts.append(f"managed by {agency_dict['en']}")
    else:
        desc_pt_parts.append("Artista e personalidade musical do K-pop")
        desc_en_parts.append("K-pop artist and music performer")
        if debut_year is not None:
            desc_pt_parts.append(f"em atividade desde {debut_year}")
            desc_en_parts.append(f"active since {debut_year}")

    description = {
        "pt-BR": " ".join(desc_pt_parts) + ".",
        "en": " ".join(desc_en_parts) + ".",
    }

    clues: dict[str, Any] = {"description": description}
    if debut_year is not None:
        clues["debut_year"] = debut_year
    if agency_dict is not None:
        clues["agency"] = agency_dict
    if members_count is not None:
        clues["members_count"] = members_count

    return clues, serialized_evidence


def generate_name_guess_puzzle(
    connection: sqlite3.Connection,
    seed: str,
    reference_date: date | None = None,
    word_length: int | None = None,
    max_attempts: int = 6,
) -> dict[str, Any]:
    """Deterministically generate a name guess puzzle from audited database facts.

    Raises ValueError if the database contains insufficient entities or evidence.
    """
    if reference_date is None:
        reference_date = datetime.now(timezone.utc).date()

    if not (4 <= max_attempts <= 8):
        raise ValueError("max_attempts must be an integer between 4 and 8")

    if word_length is not None and not (3 <= word_length <= 10):
        raise ValueError("word_length must be an integer between 3 and 10")

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, _rejected = _load_facts(connection, entities)
    dataset_version = _dataset_version(connection, entities, reference_date)

    facts_by_subject: dict[str, list[Fact]] = defaultdict(list)
    for fact in facts:
        facts_by_subject[fact.subject.wikidata_id].append(fact)

    # Collect candidate entities that possess valid QIDs, normalized names, and evidence
    eligible_candidates: list[tuple[Entity, str, list[Fact]]] = []
    for entity in sorted(entities.values(), key=lambda e: e.wikidata_id):
        if not bool(QID_REGEX.match(entity.wikidata_id)):
            continue
        norm = normalize_name(entity.canonical_name)
        if not (3 <= len(norm) <= 10):
            continue
        if word_length is not None and len(norm) != word_length:
            continue
        entity_facts = facts_by_subject.get(entity.wikidata_id, [])
        has_evidence = any(len(f.evidence) > 0 for f in entity_facts)
        if has_evidence:
            eligible_candidates.append((entity, norm, entity_facts))

    if not eligible_candidates:
        msg = "No eligible entities with evidence found in database"
        if word_length is not None:
            msg += f" for word length {word_length}"
        raise ValueError(msg)

    # Group eligible target candidates by word length
    by_length: dict[int, list[tuple[Entity, str, list[Fact]]]] = defaultdict(list)
    for candidate in eligible_candidates:
        by_length[len(candidate[1])].append(candidate)

    # Initialize deterministic RNG
    seed_bytes = hashlib.sha256(seed.encode("utf-8")).digest()
    rng = random.Random(seed_bytes)

    # Choose target entity and word length
    if word_length is None:
        # Deterministically pick a target entity across all eligible candidates
        sorted_eligible = sorted(
            eligible_candidates,
            key=lambda item: (len(item[1]), item[1], item[0].wikidata_id),
        )
        target_entity, target_normalized, target_facts = rng.choice(sorted_eligible)
        chosen_length = len(target_normalized)
    else:
        chosen_length = word_length
        target_pool = by_length[chosen_length]
        target_pool.sort(key=lambda item: (item[1], item[0].wikidata_id))
        target_entity, target_normalized, target_facts = rng.choice(target_pool)

    clues, serialized_evidence = _extract_clues_and_evidence(
        target_entity, target_facts
    )

    # Build closed set of valid guesses of the exact chosen word length
    guesses_set: set[str] = {target_normalized}

    # Harvest from all entities and aliases in the database
    for entity in entities.values():
        all_names = (
            entity.canonical_name,
            *entity.names.values(),
            *entity.aliases,
        )
        for name in all_names:
            norm_alias = normalize_name(name)
            if len(norm_alias) == chosen_length and norm_alias.isalpha():
                guesses_set.add(norm_alias)

    # Supplement with curated vocabulary of this word length
    for supplemental in CURATED_SUPPLEMENTAL_VOCABULARY.get(chosen_length, ()):
        if len(supplemental) == chosen_length and supplemental.isalpha():
            guesses_set.add(supplemental)

    valid_guesses = sorted(guesses_set)

    target_payload: dict[str, Any] = {
        "id": target_entity.wikidata_id,
        "canonical_name": target_entity.canonical_name,
        "normalized_name": target_normalized,
        "labels": {
            "pt-BR": (
                target_entity.names.get("pt")
                or target_entity.names.get("pt-BR")
                or target_entity.canonical_name
            ),
            "en": target_entity.names.get("en") or target_entity.canonical_name,
        },
        "entity_type": (
            target_entity.entity_type
            if target_entity.entity_type in {"group", "person"}
            else "group"
        ),
        "clues": clues,
        "evidence": serialized_evidence,
    }

    reference_date_str = reference_date.isoformat()

    hashable_payload = {
        "dataset_version": dataset_version,
        "max_attempts": max_attempts,
        "reference_date": reference_date_str,
        "schema_version": NAME_GUESS_SCHEMA_VERSION,
        "target": target_payload,
        "valid_guesses": valid_guesses,
        "word_length": chosen_length,
    }
    puzzle_id = hash_payload(hashable_payload)

    puzzle: dict[str, Any] = {
        "schema_version": NAME_GUESS_SCHEMA_VERSION,
        "puzzle_id": puzzle_id,
        "dataset_version": dataset_version,
        "reference_date": reference_date_str,
        "word_length": chosen_length,
        "max_attempts": max_attempts,
        "target": target_payload,
        "valid_guesses": valid_guesses,
    }

    validate_name_guess_puzzle(puzzle)
    return puzzle
