"""Build deterministic bilingual quiz questions from accepted sourced facts."""

from __future__ import annotations

import sqlite3
from collections import Counter, defaultdict
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
from .quiz_rendering import _draft_predicate, index_dated_facts, render_play_mode_variants
from .quiz_repository import _dataset_version, _load_entities, _load_facts, _load_group_relevance
from .quiz_schema import (
    DATASET_SCHEMA_VERSION,
    QUESTION_TYPES,
    REPORT_SCHEMA_VERSION,
    validate_dataset,
    validate_report,
)
from .quiz_templates import SUPPORTED_LANGUAGES, TEMPLATE_VERSION
from .quiz_utils import hash_payload
from .sources import SOURCE_POLICY_VERSION


def generate_dataset(
    connection: sqlite3.Connection,
    reference_date: date = DEFAULT_REFERENCE_DATE,
    languages: Sequence[str] = SUPPORTED_LANGUAGES,
    related_clues: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Generate a validated question bank and its rejection report.

    Related decade clues cite the answer entity's own dated fact, which is not
    one of the question's facts. A client released before they existed rejects
    the whole session that carries one, so they stay off unless
    ``related_clues`` is set. Publish them only after the client that accepts
    them has been live long enough for stale pages to be gone.
    """
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
    relevance_by_group = _load_group_relevance(connection)
    base_dataset_version = _dataset_version(connection, entities, reference_date)
    dataset_version = (
        hash_payload(
            {
                "base_dataset_version": base_dataset_version,
                "group_relevance_scores": relevance_by_group,
            }
        )
        if relevance_by_group
        else base_dataset_version
    )
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
    dated_facts = index_dated_facts(facts) if related_clues else None
    questions = []
    kept_drafts = []
    clue_outcomes_by_type: dict[str, Counter[str]] = defaultdict(Counter)
    for draft in drafts:
        decades = _subject_decades(draft, group_decades, person_memberships, performers)
        try:
            rendered = []
            outcomes: Counter[str] = Counter()
            for language in selected_languages:
                # Clue eligibility does not depend on the language, so the
                # first one is enough to count each logical question once.
                for question in render_play_mode_variants(
                    draft, language, reference_date, entities_by_qid,
                    person_memberships, relevance_by_group, dated_facts,
                    outcomes if language == selected_languages[0] else None,
                ):
                    question["decades"] = decades
                    rendered.append(question)
        except ValueError:
            # A distractor can still echo a group alias after draft filters;
            # drop the logical question instead of aborting the daily publish.
            rejected["option_label_echoes_prompt"] += 1
            continue
        kept_drafts.append(draft)
        clue_outcomes_by_type[draft.question_type].update(outcomes)
        questions.extend(rendered)
    drafts = kept_drafts
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
        "clue_coverage": _clue_coverage(clue_outcomes_by_type),
        "clue_eligible_base_questions": sum(
            outcomes["available"] for outcomes in clue_outcomes_by_type.values()
        ),
    }
    validate_dataset(payload)
    validate_report(report)
    return payload, report


def _clue_coverage(
    outcomes_by_type: dict[str, Counter[str]],
) -> dict[str, Any]:
    """Count logical questions with a safe clue, and why the others have none."""
    by_type = {
        question_type: {
            "questions": sum(outcomes_by_type[question_type].values()),
            "with_clue": outcomes_by_type[question_type]["available"],
        }
        for question_type in sorted(QUESTION_TYPES)
    }
    reasons: Counter[str] = Counter()
    for outcomes in outcomes_by_type.values():
        reasons.update(outcomes)
    reasons.pop("available", None)
    return {
        "by_type": by_type,
        "questions": sum(item["questions"] for item in by_type.values()),
        "unavailable_by_reason": dict(sorted(reasons.items())),
        "with_clue": sum(item["with_clue"] for item in by_type.values()),
    }


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
