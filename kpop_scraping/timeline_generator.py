"""Deterministic generation of timeline ("Quando foi?") puzzles from audited facts."""

from __future__ import annotations

import hashlib
import random
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable

from .quiz_models import Entity, Evidence, Fact
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_utils import reference_date_today
from .timeline_schema import (
    TIMELINE_MAX_YEAR,
    TIMELINE_MIN_EVENT_GAP_DAYS,
    TIMELINE_MIN_YEAR,
    TIMELINE_SCHEMA_VERSION,
    compute_timeline_puzzle_id,
    timeline_date_span,
    validate_timeline_puzzle,
)

QID_REGEX = re.compile(r"^Q[1-9][0-9]*$")

# Bounded resampling attempts for year sets that respect the minimum gap.
TIMELINE_MAX_SAMPLING_ATTEMPTS = 60

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


def _parse_event_date(value_time: str | None) -> tuple[str, int] | None:
    if not value_time:
        return None
    raw_time = value_time.strip()
    date_match = re.match(r"^(\d{4})(-\d{2}(-\d{2})?)?$", raw_time)
    if not date_match:
        return None
    year = int(date_match.group(1))
    if not (TIMELINE_MIN_YEAR <= year <= TIMELINE_MAX_YEAR):
        return None
    return raw_time, year


def _stable_name(entities: Iterable[Entity]) -> str | None:
    named = [entity for entity in entities if entity.canonical_name]
    if not named:
        return None
    return sorted(named, key=lambda entity: entity.wikidata_id)[0].canonical_name


def _build_formation_candidates(facts: list[Fact]) -> list[CandidateEvent]:
    """Extract group formation candidates from accepted, evidenced facts."""
    labels_by_group: dict[str, list[Entity]] = defaultdict(list)
    members_by_group: dict[str, int] = defaultdict(int)
    for fact in facts:
        subject_qid = fact.subject.wikidata_id
        if fact.predicate == "record_label" and fact.subject.entity_type == "group" and fact.value_entity:
            labels_by_group[subject_qid].append(fact.value_entity)
        elif fact.predicate == "has_member" and fact.subject.entity_type == "group":
            members_by_group[subject_qid] += 1

    candidates: list[CandidateEvent] = []
    seen_entities: set[str] = set()
    for fact in facts:
        if fact.predicate != "formed_on" or fact.subject.entity_type != "group":
            continue
        qid = fact.subject.wikidata_id
        if not QID_REGEX.match(qid) or qid in seen_entities:
            continue
        parsed = _parse_event_date(fact.value_time)
        if parsed is None:
            continue
        raw_time, year = parsed
        seen_entities.add(qid)

        entity_name = fact.subject.canonical_name
        label_name = _stable_name(labels_by_group.get(qid, ()))
        member_count = members_by_group.get(qid, 0)
        if label_name:
            desc_pt = f"Formação oficial do grupo {entity_name} sob a gravadora {label_name}."
            desc_en = f"Official formation of group {entity_name} under record label {label_name}."
        elif member_count > 1:
            desc_pt = f"Formação do grupo {entity_name}, com {member_count} integrantes."
            desc_en = f"Formation of group {entity_name}, with {member_count} members."
        else:
            desc_pt = f"Formação oficial do grupo {entity_name}."
            desc_en = f"Official formation of group {entity_name}."

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
                evidence=_serialize_evidence(fact.evidence),
            )
        )
    return candidates


def _build_birth_candidates(facts: list[Fact]) -> list[CandidateEvent]:
    """Extract idol birth candidates from accepted, evidenced facts."""
    groups_by_person: dict[str, list[Entity]] = defaultdict(list)
    for fact in facts:
        if (
            fact.predicate == "member_of"
            and fact.subject.entity_type == "person"
            and fact.value_entity is not None
        ):
            groups_by_person[fact.subject.wikidata_id].append(fact.value_entity)
        elif (
            fact.predicate == "has_member"
            and fact.subject.entity_type == "group"
            and fact.value_entity is not None
        ):
            groups_by_person[fact.value_entity.wikidata_id].append(fact.subject)

    candidates: list[CandidateEvent] = []
    seen_entities: set[str] = set()
    for fact in facts:
        if fact.predicate != "born_on" or fact.subject.entity_type != "person":
            continue
        qid = fact.subject.wikidata_id
        if not QID_REGEX.match(qid) or qid in seen_entities:
            continue
        parsed = _parse_event_date(fact.value_time)
        if parsed is None:
            continue
        raw_time, year = parsed
        seen_entities.add(qid)

        entity_name = fact.subject.canonical_name
        group_name = _stable_name(groups_by_person.get(qid, ()))
        if group_name:
            desc_pt = f"Nascimento de {entity_name}, integrante do grupo {group_name}."
            desc_en = f"Birth of {entity_name}, member of group {group_name}."
        else:
            desc_pt = f"Nascimento do artista {entity_name}."
            desc_en = f"Birth of artist {entity_name}."

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
                evidence=_serialize_evidence(fact.evidence),
            )
        )
    return candidates


def _satisfies_min_gap(events: list[CandidateEvent]) -> bool:
    """Check the conservative 30-day gap over precision spans for ordered events."""
    prev_span_max = None
    for cand in sorted(events, key=lambda c: (c.date, c.id)):
        span_min, span_max = timeline_date_span(cand.date)
        if prev_span_max is not None and (span_min - prev_span_max).days < TIMELINE_MIN_EVENT_GAP_DAYS:
            return False
        prev_span_max = span_max
    return True


def _select_events_from_pool(
    pool: list[CandidateEvent],
    rng: random.Random,
    seed: str,
) -> list[CandidateEvent]:
    """Pick 5 events with distinct years that respect the conservative 30-day gap."""
    by_year: dict[int, list[CandidateEvent]] = defaultdict(list)
    for cand in pool:
        by_year[cand.year].append(cand)

    available_years = sorted(by_year.keys())
    if len(available_years) < 5:
        raise ValueError(
            f"Not enough distinct years available for timeline puzzle: {len(available_years)} < 5"
        )

    chosen_events: list[CandidateEvent] | None = None
    for _ in range(TIMELINE_MAX_SAMPLING_ATTEMPTS):
        chosen_years = sorted(rng.sample(available_years, 5))
        picks: list[CandidateEvent] = []
        for yr in chosen_years:
            candidates_in_year = sorted(by_year[yr], key=lambda c: (c.date, c.id))
            picks.append(rng.choice(candidates_in_year))
        if _satisfies_min_gap(picks):
            chosen_events = picks
            break

    if chosen_events is None:
        raise ValueError(
            "Unable to select 5 events respecting the minimum "
            f"{TIMELINE_MIN_EVENT_GAP_DAYS}-day gap for timeline puzzle with seed {seed!r}"
        )

    chosen_events.sort(key=lambda c: (c.date, c.id))
    for idx in range(1, len(chosen_events)):
        if chosen_events[idx].date <= chosen_events[idx - 1].date:
            raise ValueError(
                f"Generated events not in strictly ascending order: "
                f"{chosen_events[idx].date} <= {chosen_events[idx - 1].date}"
            )
    return chosen_events


def _puzzle_from_theme(
    theme: dict[str, Any],
    events: list[CandidateEvent],
    dataset_version: str,
    reference_date: str,
) -> dict[str, Any]:
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
        for ev in events
    ]
    puzzle_candidate: dict[str, Any] = {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "puzzle_id": "0" * 64,
        "dataset_version": dataset_version,
        "reference_date": reference_date,
        "theme": theme["theme"],
        "theme_description": theme["theme_description"],
        "events": events_payload,
    }
    puzzle_candidate["puzzle_id"] = compute_timeline_puzzle_id(puzzle_candidate)
    validate_timeline_puzzle(puzzle_candidate)
    return puzzle_candidate


def generate_timeline_puzzle(
    connection: sqlite3.Connection,
    reference_date: date | str | None = None,
    seed: str | None = None,
) -> dict[str, Any]:
    """Deterministically generate a 5-event timeline puzzle for the given date and seed."""
    if reference_date is None:
        ref_date_str = reference_date_today()
        ref_date = date.fromisoformat(ref_date_str)
    elif isinstance(reference_date, str):
        ref_date = date.fromisoformat(reference_date)
    else:
        ref_date = reference_date

    ref_date_str = ref_date.isoformat()
    actual_seed = seed or f"kpop-timeline-daily-{ref_date_str}"
    seed_digest = hashlib.sha256(actual_seed.encode("utf-8")).digest()
    rng = random.Random(seed_digest)

    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    dataset_version = _dataset_version(connection, entities, ref_date)
    facts, _rejected = _load_facts(connection, entities)

    formation_candidates = _build_formation_candidates(facts)
    birth_candidates = _build_birth_candidates(facts)

    themes: list[dict[str, Any]] = [
        {
            "id": "group_formations",
            "theme": {
                "pt-BR": "Formação de grupos históricos",
                "en": "Formation of historic groups",
            },
            "theme_description": {
                "pt-BR": "Ordene cronologicamente os anos de formação destes grupos.",
                "en": "Order the formation years of these groups chronologically.",
            },
            "pool": formation_candidates,
        },
        {
            "id": "kpop_evolution",
            "theme": {
                "pt-BR": "Evolução das gerações do K-pop",
                "en": "Evolution of K-pop generations",
            },
            "theme_description": {
                "pt-BR": "Organize em ordem cronológica os anos de formação de grupos de diferentes gerações do K-pop.",
                "en": "Arrange the formation years of groups from different K-pop generations in chronological order.",
            },
            "pool": formation_candidates,
        },
        {
            "id": "idol_births",
            "theme": {
                "pt-BR": "Nascimento de idols",
                "en": "Births of idols",
            },
            "theme_description": {
                "pt-BR": "Ordene cronologicamente as datas de nascimento destes artistas.",
                "en": "Order the birth dates of these artists chronologically.",
            },
            "pool": birth_candidates,
        },
    ]

    chosen_theme = rng.choice(themes)
    theme_order = [chosen_theme] + [theme for theme in themes if theme is not chosen_theme]
    last_error: Exception | None = None
    for theme in theme_order:
        try:
            chosen_events = _select_events_from_pool(theme["pool"], rng, actual_seed)
            return _puzzle_from_theme(theme, chosen_events, dataset_version, ref_date_str)
        except ValueError as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise ValueError(f"Unable to generate a valid timeline puzzle with seed {actual_seed!r}")
