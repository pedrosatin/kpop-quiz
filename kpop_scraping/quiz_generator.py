"""Build deterministic bilingual quiz questions from accepted sourced facts."""

from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import date
from typing import Any, Sequence

from .quiz_drafts import _build_drafts, _membership_pairs
from .quiz_models import (
    DEFAULT_REFERENCE_DATE,
    Draft,
    Fact,
    GENERATOR_VERSION,
    InsufficientQuestionsError,
    QuizConfig,
)
from .quiz_rendering import _draft_predicate, render_play_mode_variants
from .quiz_repository import _dataset_version, _load_entities, _load_facts
from .quiz_schema import (
    DATASET_SCHEMA_VERSION,
    QUESTION_TYPES,
    REPORT_SCHEMA_VERSION,
    validate_dataset,
    validate_report,
)
from .quiz_session import create_session
from .quiz_templates import SUPPORTED_LANGUAGES, TEMPLATE_VERSION
from .sources import SOURCE_POLICY_VERSION


def generate_dataset(
    connection: sqlite3.Connection,
    reference_date: date = DEFAULT_REFERENCE_DATE,
    languages: Sequence[str] = SUPPORTED_LANGUAGES,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Generate a validated question bank and its rejection report."""
    requested_languages = set(languages)
    selected_languages = tuple(
        language for language in SUPPORTED_LANGUAGES if language in requested_languages
    )
    if not selected_languages or requested_languages - set(SUPPORTED_LANGUAGES):
        raise ValueError("languages must contain pt-BR or en")
    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, rejected = _load_facts(connection, entities)
    person_memberships = _person_memberships(facts)
    dataset_version = _dataset_version(connection, entities, reference_date)
    drafts, generation_rejections = _build_drafts(facts, entities, reference_date)
    rejected.update(generation_rejections)
    entities_by_qid = {entity.wikidata_id: entity for entity in entities.values()}
    group_decades = {
        fact.subject.wikidata_id: (int((fact.value_time or "")[:4]) // 10) * 10
        for fact in facts
        if fact.predicate == "formed_on"
        and fact.subject.entity_type == "group"
        and (fact.value_time or "")[:4].isdigit()
    }
    performers = _performers_by_release(facts)
    questions = []
    for draft in drafts:
        decades = _subject_decades(draft, group_decades, person_memberships, performers)
        for language in selected_languages:
            for question in render_play_mode_variants(
                draft, language, reference_date, entities_by_qid, person_memberships
            ):
                question["decades"] = decades
                questions.append(question)
    questions.sort(
        key=lambda question: (
            question["logical_id"], question["language"], question["play_mode"]
        )
    )
    payload = {
        "dataset_version": dataset_version,
        "generator_version": GENERATOR_VERSION,
        "language_variant_count": len(questions),
        "languages": list(selected_languages),
        "logical_question_count": len(drafts),
        "questions": questions,
        "reference_date": reference_date.isoformat(),
        "schema_version": DATASET_SCHEMA_VERSION,
        "source_policy_version": SOURCE_POLICY_VERSION,
        "template_version": TEMPLATE_VERSION,
    }
    accepted = Counter(draft.question_type for draft in drafts)
    accepted_by_predicate = Counter(_draft_predicate(draft) for draft in drafts)
    fact_base_count = len(
        {fact_id for draft in drafts for fact_id in draft.fact_base_ids}
    )
    report = {
        "accepted_by_predicate": dict(sorted(accepted_by_predicate.items())),
        "accepted_by_template": {
            question_type: accepted[question_type]
            for question_type in sorted(QUESTION_TYPES)
        },
        "accepted_by_type": {
            question_type: accepted[question_type]
            for question_type in sorted(QUESTION_TYPES)
        },
        "accepted_logical": len(drafts),
        "accepted_distinct_fact_bases": fact_base_count,
        "dataset_version": dataset_version,
        "language_variants": len(questions),
        "rejected_by_reason": dict(sorted(rejected.items())),
        "schema_version": REPORT_SCHEMA_VERSION,
        "variants_by_language": {
            language: len(drafts) * 3 for language in selected_languages
        },
        "variants_by_play_mode": {
            play_mode: len(drafts)
            for play_mode in ("assisted", "standard", "expert")
        },
        "clue_eligible_base_questions": sum(
            bool(render_play_mode_variants(
                draft, "en", reference_date, entities_by_qid, person_memberships
            )[0]["clues_available"])
            for draft in drafts
        ),
    }
    validate_dataset(payload)
    validate_report(report)
    return payload, report


SESSION_DECADES = frozenset({1990, 2000, 2010, 2020})


def _performers_by_release(facts: Sequence[Fact]) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, set[str]] = {}
    for fact in facts:
        if fact.predicate == "performed_by" and fact.value_entity is not None:
            grouped.setdefault(fact.subject.wikidata_id, set()).add(
                fact.value_entity.wikidata_id
            )
    return {
        release_id: tuple(sorted(group_ids))
        for release_id, group_ids in grouped.items()
    }


def _subject_decades(
    draft: Draft,
    group_decades: dict[str, int],
    memberships: dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]],
    performers: dict[str, tuple[str, ...]],
) -> list[int]:
    """Formation decades of the answer subject, limited to 1990, 2000, 2010, and 2020."""
    if draft.question_type == "chronological_comparison":
        if draft.values.get("comparison_kind") == "person":
            group_ids = tuple(
                group_id for group_id, _facts in memberships.get(draft.answer[0], ())
            )
        else:
            group_ids = (draft.answer[0],)
    elif draft.question_type == "earliest_release":
        group_ids = performers.get(draft.answer[0], ())
    else:
        group_ids = draft.group_ids
    return sorted({
        decade
        for group_id in group_ids
        if (decade := group_decades.get(group_id)) in SESSION_DECADES
    })


def _person_memberships(
    facts: Sequence[Fact],
) -> dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]]:
    """Return each person's sourced group intervals, ordered by group id."""
    grouped: dict[str, list[tuple[str, tuple[Fact, ...]]]] = {}
    for group, person, pair_facts in _membership_pairs(list(facts)):
        grouped.setdefault(person.wikidata_id, []).append(
            (group.wikidata_id, pair_facts)
        )
    return {
        person_id: tuple(sorted(pairs, key=lambda item: item[0]))
        for person_id, pairs in grouped.items()
    }
