"""Deterministic generation of timeline ("Quando foi?") puzzles from audited facts."""

from __future__ import annotations

import hashlib
import random
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .quiz_models import Entity, Evidence
from .quiz_repository import _dataset_version, _load_entities, _load_evidence
from .timeline_schema import (
    TIMELINE_SCHEMA_VERSION,
    compute_timeline_puzzle_id,
    validate_timeline_puzzle,
)

PT_MONTHS = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]

EN_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


@dataclass(frozen=True)
class CandidateEvent:
    id: str
    event_type: str
    date: str
    year: int
    display_date: dict[str, str]
    title: dict[str, str]
    description: dict[str, str]
    entity_id: str
    entity_name: str
    evidence: list[dict[str, Any]]


def format_display_date(date_str: str) -> dict[str, str]:
    """Format an ISO date string into bilingual display dates."""
    parts = date_str.split("-")
    if len(parts) == 1:
        return {"pt-BR": parts[0], "en": parts[0]}
    if len(parts) == 2:
        year = parts[0]
        month = int(parts[1])
        m_pt = PT_MONTHS[month - 1].capitalize()
        m_en = EN_MONTHS[month - 1]
        return {"pt-BR": f"{m_pt} de {year}", "en": f"{m_en} {year}"}
    if len(parts) == 3:
        year = parts[0]
        month = int(parts[1])
        day = int(parts[2])
        m_pt = PT_MONTHS[month - 1]
        m_en = EN_MONTHS[month - 1]
        return {"pt-BR": f"{day} de {m_pt} de {year}", "en": f"{m_en} {day}, {year}"}
    return {"pt-BR": date_str, "en": date_str}


def _serialize_evidence(evidence_items: Iterable[Evidence]) -> list[dict[str, Any]]:
    """Deduplicate and canonically sort evidence records."""
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


def _build_formation_candidates(
    connection: sqlite3.Connection,
    evidence_map: dict[int, tuple[Evidence, ...]],
) -> list[CandidateEvent]:
    """Extract eligible group formation candidates with audited facts and evidence."""
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT f.id as fact_id, f.value_time,
               e.wikidata_id, e.canonical_name,
               (
                   SELECT e_label.canonical_name
                   FROM facts f_lbl
                   JOIN entities e_label ON e_label.id = f_lbl.value_entity_id
                   WHERE f_lbl.subject_entity_id = e.id AND f_lbl.predicate = 'record_label'
                   LIMIT 1
               ) as label_name,
               (
                   SELECT count(f_mem.id)
                   FROM facts f_mem
                   WHERE f_mem.subject_entity_id = e.id AND f_mem.predicate = 'has_member'
               ) as member_count
        FROM facts f
        JOIN entities e ON e.id = f.subject_entity_id
        WHERE f.predicate = 'formed_on' AND e.entity_type = 'group'
        ORDER BY f.value_time ASC, e.canonical_name ASC
        """
    )
    candidates: list[CandidateEvent] = []
    seen_entities: set[str] = set()

    for row in cursor.fetchall():
        fact_id = int(row["fact_id"])
        evidence = evidence_map.get(fact_id, ())
        if not evidence:
            continue

        raw_time = str(row["value_time"]).strip()
        date_match = re.match(r"^(\d{4})(-\d{2}(-\d{2})?)?$", raw_time)
        if not date_match:
            continue

        year = int(date_match.group(1))
        if not (1980 <= year <= 2035):
            continue

        qid = str(row["wikidata_id"])
        if qid in seen_entities:
            continue
        seen_entities.add(qid)

        entity_name = str(row["canonical_name"])
        label_name = row["label_name"]
        member_count = row["member_count"]

        if label_name:
            desc_pt = f"Formação oficial do grupo musical {entity_name} sob a gestão da gravadora {label_name}."
            desc_en = f"Official formation of musical group {entity_name} under record label {label_name}."
        elif member_count and member_count > 1:
            desc_pt = f"Formação do grupo musical {entity_name}, composto por {member_count} integrantes no cenário K-pop."
            desc_en = f"Formation of musical group {entity_name}, featuring {member_count} members in the K-pop scene."
        else:
            desc_pt = f"Marco de formação e criação oficial do grupo musical {entity_name} no universo K-pop."
            desc_en = f"Official creation and formation milestone of musical group {entity_name} in K-pop history."

        candidates.append(
            CandidateEvent(
                id=f"timeline-formation-{qid}",
                event_type="formation",
                date=raw_time,
                year=year,
                display_date=format_display_date(raw_time),
                title={
                    "pt-BR": f"Formação de {entity_name}",
                    "en": f"Formation of {entity_name}",
                },
                description={"pt-BR": desc_pt, "en": desc_en},
                entity_id=qid,
                entity_name=entity_name,
                evidence=_serialize_evidence(evidence),
            )
        )

    return candidates


def _build_birth_candidates(
    connection: sqlite3.Connection,
    evidence_map: dict[int, tuple[Evidence, ...]],
) -> list[CandidateEvent]:
    """Extract eligible idol birth candidates with audited facts and evidence."""
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT f.id as fact_id, f.value_time,
               e.wikidata_id, e.canonical_name,
               (
                   SELECT e_grp.canonical_name
                   FROM facts f_grp
                   JOIN entities e_grp ON e_grp.id = f_grp.value_entity_id
                   WHERE f_grp.subject_entity_id = e.id AND f_grp.predicate = 'member_of'
                   LIMIT 1
               ) as group_name
        FROM facts f
        JOIN entities e ON e.id = f.subject_entity_id
        WHERE f.predicate = 'born_on' AND e.entity_type = 'person'
        ORDER BY f.value_time ASC, e.canonical_name ASC
        """
    )
    candidates: list[CandidateEvent] = []
    seen_entities: set[str] = set()

    for row in cursor.fetchall():
        fact_id = int(row["fact_id"])
        evidence = evidence_map.get(fact_id, ())
        if not evidence:
            continue

        raw_time = str(row["value_time"]).strip()
        date_match = re.match(r"^(\d{4})(-\d{2}(-\d{2})?)?$", raw_time)
        if not date_match:
            continue

        year = int(date_match.group(1))
        if not (1980 <= year <= 2035):
            continue

        qid = str(row["wikidata_id"])
        if qid in seen_entities:
            continue
        seen_entities.add(qid)

        entity_name = str(row["canonical_name"])
        group_name = row["group_name"]

        if group_name:
            desc_pt = f"Nascimento de {entity_name}, artista consagrado e integrante do grupo {group_name}."
            desc_en = f"Birth of {entity_name}, celebrated artist and member of group {group_name}."
        else:
            desc_pt = f"Nascimento do artista e personalidade musical {entity_name} no cenário K-pop."
            desc_en = f"Birth of K-pop artist and musical performer {entity_name}."

        candidates.append(
            CandidateEvent(
                id=f"timeline-birth-{qid}",
                event_type="birth",
                date=raw_time,
                year=year,
                display_date=format_display_date(raw_time),
                title={
                    "pt-BR": f"Nascimento de {entity_name}",
                    "en": f"Birth of {entity_name}",
                },
                description={"pt-BR": desc_pt, "en": desc_en},
                entity_id=qid,
                entity_name=entity_name,
                evidence=_serialize_evidence(evidence),
            )
        )

    return candidates


def generate_timeline_puzzle(
    connection: sqlite3.Connection,
    reference_date: date | str | None = None,
    seed: str | None = None,
) -> dict[str, Any]:
    """Deterministically generate a 5-event timeline puzzle for the given date and seed."""
    if reference_date is None:
        ref_date = datetime.now(timezone.utc).date()
    elif isinstance(reference_date, str):
        ref_date = date.fromisoformat(reference_date)
    else:
        ref_date = reference_date

    ref_date_str = ref_date.isoformat()
    actual_seed = seed or f"kpop-timeline-daily-{ref_date_str}"
    seed_hash = hashlib.sha256(actual_seed.encode("utf-8")).hexdigest()
    rng = random.Random(int(seed_hash, 16))

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    dataset_version = _dataset_version(connection, entities, ref_date)
    evidence_map = _load_evidence(connection)

    formation_candidates = _build_formation_candidates(connection, evidence_map)
    birth_candidates = _build_birth_candidates(connection, evidence_map)

    themes: list[dict[str, Any]] = [
        {
            "id": "group_formations",
            "theme": {
                "pt-BR": "Formação de Grupos Históricos",
                "en": "Historical Group Formations",
            },
            "theme_description": {
                "pt-BR": "Ordene cronologicamente os anos de fundação e estreia destes grupos fundamentais do K-pop.",
                "en": "Order the foundation and debut years of these foundational K-pop groups chronologically.",
            },
            "pool": formation_candidates,
        },
        {
            "id": "kpop_evolution",
            "theme": {
                "pt-BR": "Evolução das Gerações do K-pop",
                "en": "Evolution of K-pop Generations",
            },
            "theme_description": {
                "pt-BR": "Organize em ordem cronológica a trajetória de grupos que marcaram diferentes gerações do K-pop.",
                "en": "Arrange the chronological journey of groups that marked different generations of K-pop.",
            },
            "pool": formation_candidates,
        },
        {
            "id": "idol_births",
            "theme": {
                "pt-BR": "Nascimento de Grandes Idols",
                "en": "Births of Prominent Idols",
            },
            "theme_description": {
                "pt-BR": "Ordene cronologicamente as datas de nascimento destes artistas consagrados do K-pop.",
                "en": "Order the birth dates of these celebrated K-pop artists chronologically.",
            },
            "pool": birth_candidates,
        },
    ]

    # Deterministically select a theme
    chosen_theme = rng.choice(themes)
    pool = chosen_theme["pool"]
    if len(pool) < 5:
        # Fallback to formations if pool is too small
        chosen_theme = themes[0]
        pool = chosen_theme["pool"]

    # Group candidates by year
    by_year: dict[int, list[CandidateEvent]] = defaultdict(list)
    for cand in pool:
        by_year[cand.year].append(cand)

    available_years = sorted(by_year.keys())
    if len(available_years) < 5:
        raise ValueError(
            f"Not enough distinct years available for timeline puzzle: {len(available_years)} < 5"
        )

    # Pick 5 distinct years deterministically
    chosen_years = sorted(rng.sample(available_years, 5))

    # For each year, deterministically select 1 candidate
    chosen_events: list[CandidateEvent] = []
    for yr in chosen_years:
        candidates_in_year = sorted(by_year[yr], key=lambda c: (c.date, c.id))
        chosen_events.append(rng.choice(candidates_in_year))

    # Sort strictly by date ascending
    chosen_events.sort(key=lambda c: (c.date, c.id))

    # Verify strict ascending order
    for idx in range(1, len(chosen_events)):
        if chosen_events[idx].date <= chosen_events[idx - 1].date:
            raise ValueError(
                f"Generated events not in strictly ascending order: {chosen_events[idx].date} <= {chosen_events[idx - 1].date}"
            )

    # Build events list for puzzle
    events_payload: list[dict[str, Any]] = [
        {
            "id": ev.id,
            "event_type": ev.event_type,
            "date": ev.date,
            "year": ev.year,
            "display_date": ev.display_date,
            "title": ev.title,
            "description": ev.description,
            "entity_id": ev.entity_id,
            "entity_name": ev.entity_name,
            "evidence": ev.evidence,
        }
        for ev in chosen_events
    ]

    puzzle_candidate: dict[str, Any] = {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "puzzle_id": "0" * 64,  # placeholder
        "dataset_version": dataset_version,
        "reference_date": ref_date_str,
        "theme": chosen_theme["theme"],
        "theme_description": chosen_theme["theme_description"],
        "events": events_payload,
    }

    puzzle_id = compute_timeline_puzzle_id(puzzle_candidate)
    puzzle_candidate["puzzle_id"] = puzzle_id

    validate_timeline_puzzle(puzzle_candidate)
    return puzzle_candidate
