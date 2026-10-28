"""Render language-neutral quiz drafts into publishable questions."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from .quiz_models import Draft, Entity, Fact, GENERATOR_VERSION
from .quiz_templates import render
from .quiz_utils import digest, hash_payload
from .release_quiz_drafts import _contains_identity, _group_identities as _entity_identities


def _group_relevance_score(
    group_ids: tuple[str, ...] | list[str],
    relevance_by_group: dict[str, int] | None,
) -> int | None:
    """Return the highest group score, or None if any group was not measured.

    Missing groups are not zero. A zero would look like an obscure group and
    would drop the question from assisted mode.
    """
    if not group_ids or not relevance_by_group:
        return None
    scores: list[int] = []
    for group_id in group_ids:
        score = relevance_by_group.get(group_id)
        if score is None:
            return None
        scores.append(score)
    return max(scores)


def _render_draft(
    draft: Draft,
    language: str,
    reference_date: date,
    entities: dict[str, Entity],
    relevance_by_group: dict[str, int] | None = None,
) -> dict[str, Any]:
    logical_id = hash_payload({"key": draft.key, "generator": GENERATOR_VERSION})
    semantic_id = hash_payload(
        {
            "fact_base_ids": draft.fact_base_ids,
            "question_type": draft.question_type,
        }
    )
    values = dict(draft.values)
    for key in ("group_id", "person_id", "release_id"):
        if key in values:
            values[key.removesuffix("_id")] = entities[values[key]].name(language)
    if "record_label_id" in values:
        values["record_label"] = entities[values["record_label_id"]].name(language)
    if "date" in values:
        precision = 9 if len(values["date"]) == 4 else 10 if len(values["date"]) == 7 else 11
        values["date"] = _format_date(values["date"], precision, language)
    if "born_on" in values:
        precision = 9 if len(values["born_on"]) == 4 else 10 if len(values["born_on"]) == 7 else 11
        values["born_on"] = _format_date(values["born_on"], precision, language)
    answer_value, answer_kind = draft.answer
    answer_label = _option_label(answer_value, answer_kind, language, entities)
    values["answer"] = answer_label
    if draft.question_type == "chronological_comparison":
        field = f"{values['comparison_kind']}_prompt"
        explanation_field = f"{values['comparison_kind']}_explanation"
        values["date"] = _format_date(
            draft.values["date"], int(draft.values["date_precision"]), language
        )
        values["comparison"] = "; ".join(
            f"{entities[qid].name(language)} ({_format_date(raw_date, precision, language)})"
            for qid, raw_date, precision in draft.values["comparison_values"]
        )
    elif draft.question_type == "earliest_release":
        field = "prompt"
        explanation_field = "explanation"
        values["comparison"] = "; ".join(
            f"{entities[qid].name(language)} ({_format_date(raw_date, precision, language)})"
            for qid, raw_date, precision in draft.values["comparison_values"]
        )
    else:
        field = "prompt"
        explanation_field = "explanation"
    options = [
        {
            "id": hash_payload({"kind": kind, "value": value}),
            "label": _option_label(value, kind, language, entities),
            "value": value,
            "value_type": kind,
        }
        for value, kind in draft.alternatives
    ]
    if len({option["label"] for option in options}) != 4:
        raise ValueError(f"translated option labels are not distinct for {draft.key}")
    options.sort(key=lambda option: digest(logical_id, option["id"]))
    answer_option_id = hash_payload({"kind": answer_kind, "value": answer_value})
    base_question = {
        "answer_option_id": answer_option_id,
        "base_logical_id": logical_id,
        "challenge_rating": draft.difficulty,
        "evidence": [item.payload() for item in draft.evidence],
        "explanation": render(
            draft.question_type, language, explanation_field, **values
        ),
        "fact_base_ids": list(draft.fact_base_ids),
        "group_ids": list(draft.group_ids),
        # The generator replaces this placeholder with decades derived from
        # cited group formation facts.
        "decades": [],
        "id": hash_payload({"language": language, "logical_id": logical_id}),
        "language": language,
        "logical_id": logical_id,
        "options": options,
        "prompt": render(draft.question_type, language, field, **values),
        "reference_date": reference_date.isoformat(),
        "semantic_id": semantic_id,
        "theme": draft.theme,
        "type": draft.question_type,
    }
    # For several groups, the best-known measured one sets mode eligibility.
    # Leave the field off when any referenced group has no measurement.
    score = _group_relevance_score(draft.group_ids, relevance_by_group)
    if score is not None:
        base_question["group_relevance_score"] = score
    return base_question


# Dated predicate, per entity kind, that can narrow a question whose answer is
# an entity. The clue cites the answer entity's own accepted fact.
_DATED_PREDICATE_BY_KIND = {
    "group": "formed_on",
    "person": "born_on",
    "release": "released_on",
}
# Questions whose prompt or options already show dates get no related clue.
_RELATED_CLUE_TYPES = frozenset({
    "group_for_member",
    "group_for_record_label",
    "group_for_release",
    "member_for_group",
    "release_for_group",
})

DatedFacts = dict[tuple[str, str], tuple[Fact, ...]]


def index_dated_facts(facts: list[Fact] | tuple[Fact, ...]) -> DatedFacts:
    """Index accepted, evidenced facts with a year-or-finer date by predicate and subject."""
    indexed: dict[tuple[str, str], list[Fact]] = {}
    for fact in facts:
        if (
            fact.predicate in _DATED_PREDICATE_BY_KIND.values()
            and fact.evidence
            and (fact.value_time or "")[:4].isdigit()
            and (fact.value_precision is None or fact.value_precision >= 9)
        ):
            indexed.setdefault((fact.predicate, fact.subject.wikidata_id), []).append(fact)
    return {key: tuple(value) for key, value in indexed.items()}


def render_play_mode_variants(
    draft: Draft,
    language: str,
    reference_date: date,
    entities: dict[str, Entity],
    person_memberships: dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]],
    relevance_by_group: dict[str, int] | None = None,
    dated_facts: DatedFacts | None = None,
    clue_outcomes: Counter[str] | None = None,
) -> list[dict[str, Any]]:
    """Render reproducible play modes without changing the underlying answer.

    ``clue_outcomes`` receives one entry per call: ``available`` or the reason
    the question has no safe clue.
    """
    base = _render_draft(draft, language, reference_date, entities, relevance_by_group)
    clues, reason = _clues_for_draft(draft, language, base, dated_facts or {}, entities)
    if clue_outcomes is not None:
        clue_outcomes[reason or "available"] += 1
    variants = []
    for play_mode, points in (("assisted", 70), ("standard", 100), ("expert", 130)):
        question = dict(base)
        question["play_mode"] = play_mode
        question["base_points"] = points
        question["hint_cost"] = 0 if play_mode == "assisted" else 15
        question["clues_available"] = [] if play_mode == "expert" else clues
        question["clues_shown"] = [clues[0]["id"]] if play_mode == "assisted" and clues else []
        if play_mode == "assisted" and not _prompt_names_an_entity(draft):
            # Group labels may only help where the prompt names no entity.
            # On member questions the parenthetical would repeat the asked
            # group on the answer option and give it away.
            question["options"] = _add_group_labels_to_people(
                question["options"], language, entities, person_memberships
            )
        _assert_options_do_not_echo_prompt(draft, question["options"], entities)
        question["id"] = hash_payload(
            {
                "language": language,
                "logical_id": question["logical_id"],
                "play_mode": play_mode,
            }
        )
        variants.append(question)
    return variants


def _add_group_labels_to_people(
    options: list[dict[str, str]],
    language: str,
    entities: dict[str, Entity],
    person_memberships: dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]],
) -> list[dict[str, str]]:
    """Append each person's sourced group names to their option label."""
    labeled_options = []
    for option in options:
        group_ids = tuple(
            group_id for group_id, _pair_facts in person_memberships.get(option["value"], ())
        )
        if option["value_type"] != "person" or not group_ids:
            labeled_options.append(option)
            continue
        groups = " · ".join(entities[group_id].name(language) for group_id in group_ids)
        labeled_options.append({**option, "label": f"{option['label']} ({groups})"})
    return labeled_options


# Which draft value each prompt names. The answer must never be derivable
# from the prompt text plus an option label, so labels may not repeat these.
_PROMPT_NAMED_ENTITY_KEYS = {
    "age_on_date": "person_id",
    "birth_date_or_place": "person_id",
    "formation_year": "group_id",
    "group_for_member": "person_id",
    "group_for_record_label": "record_label_id",
    "group_for_release": "release_id",
    "member_at_date": "group_id",
    "member_for_group": "group_id",
    "record_label_for_group": "group_id",
    "release_for_group": "group_id",
    "release_year": "release_id",
}


def _prompt_named_entity_id(draft: Draft) -> str | None:
    named_key = _PROMPT_NAMED_ENTITY_KEYS.get(draft.question_type)
    if named_key is None:
        return None
    value = draft.values.get(named_key)
    return value if isinstance(value, str) else None


def _prompt_names_an_entity(draft: Draft) -> bool:
    return _prompt_named_entity_id(draft) is not None


def _assert_options_do_not_echo_prompt(
    draft: Draft,
    options: list[dict[str, Any]],
    entities: dict[str, Entity],
) -> None:
    """Reject any option label that repeats the entity named in the prompt."""
    named_id = _prompt_named_entity_id(draft)
    if named_id is None:
        return
    named = entities.get(named_id)
    if named is None:
        return
    for option in options:
        for identity, allow_short in _entity_identities(named):
            if _contains_identity(option["label"], identity, allow_short=allow_short):
                raise ValueError(
                    f"option label echoes the prompt subject for {draft.key}: "
                    f"{option['label']!r} mentions {identity!r}"
                )


NO_CLUE_RULE = "no_clue_rule_for_type"
CLUE_NOT_NARROWING = "clue_does_not_narrow_options"
CLUE_ISOLATES_ANSWER = "clue_would_isolate_answer"
CLUE_NO_DECADE = "clue_answer_date_missing_or_ambiguous"
CLUE_ECHOES_ANSWER = "clue_text_repeats_answer"


def _clues_for_draft(
    draft: Draft,
    language: str,
    question: dict[str, Any],
    dated_facts: DatedFacts,
    entities: dict[str, Entity],
) -> tuple[list[dict[str, Any]], str | None]:
    """Return the safe clues of a question, or the reason there are none."""
    if draft.answer[1] == "time" or draft.question_type == "age_on_date":
        return _temporal_clues(draft, language, question)
    if draft.question_type in _RELATED_CLUE_TYPES:
        return _related_decade_clues(draft, language, question, dated_facts, entities)
    return [], NO_CLUE_RULE


def _decade_text(decade: str, language: str, subject: str) -> str:
    label = f"{decade}0"
    if language == "pt-BR":
        return {
            "group": f"O grupo correto foi formado na década de {label}.",
            "person": f"A pessoa correta nasceu na década de {label}.",
            "release": f"O lançamento correto é da década de {label}.",
        }[subject]
    return {
        "group": f"The correct group formed in the {label}s.",
        "person": f"The correct person was born in the {label}s.",
        "release": f"The correct release came out in the {label}s.",
    }[subject]


def _fact_decades(facts: tuple[Fact, ...]) -> set[str]:
    return {(fact.value_time or "")[:3] for fact in facts}


def _related_decade_clues(
    draft: Draft,
    language: str,
    question: dict[str, Any],
    dated_facts: DatedFacts,
    entities: dict[str, Entity],
) -> tuple[list[dict[str, Any]], str | None]:
    """Build a decade clue from the answer entity's own dated fact.

    Only options whose own accepted facts all name a different decade count as
    ruled out; an option without a dated fact stays possible. The clue is kept
    only when it rules out at least one option and leaves at least two.
    """
    answer_value, answer_kind = draft.answer
    predicate = _DATED_PREDICATE_BY_KIND.get(answer_kind)
    if predicate is None:
        return [], NO_CLUE_RULE
    answer_facts = dated_facts.get((predicate, answer_value), ())
    answer_decades = _fact_decades(answer_facts)
    if len(answer_decades) != 1:
        return [], CLUE_NO_DECADE
    answer_decade = next(iter(answer_decades))
    ruled_out = 0
    for option in draft.alternatives:
        decades = _fact_decades(dated_facts.get((predicate, option[0]), ()))
        if decades and answer_decade not in decades:
            ruled_out += 1
    remaining = len(draft.alternatives) - ruled_out
    if ruled_out == 0:
        return [], CLUE_NOT_NARROWING
    if remaining < 2:
        return [], CLUE_ISOLATES_ANSWER
    text = _decade_text(answer_decade, language, answer_kind)
    answer_label = _option_label(answer_value, answer_kind, language, entities)
    if answer_label.casefold() in text.casefold():
        return [], CLUE_ECHOES_ANSWER
    evidence = _merge_clue_evidence(answer_facts)
    fact_base_ids = sorted({item.fact_base_id for item in evidence})
    clue_id = hash_payload(
        {"fact_base_ids": fact_base_ids, "type": "decade", "value": f"{answer_decade}0s"}
    )
    return [{
        "evidence": [item.payload() for item in evidence],
        "fact_base_ids": fact_base_ids,
        "id": clue_id,
        "text": text,
        "type": "decade",
    }], None


def _merge_clue_evidence(facts: tuple[Fact, ...]) -> tuple[Any, ...]:
    unique = {
        (item.fact_base_id, item.source_url, item.locator, item.source_key, item.revision_id): item
        for fact in facts
        for item in fact.evidence
    }
    return tuple(unique[key] for key in sorted(unique))


def _temporal_clues(
    draft: Draft, language: str, question: dict[str, Any]
) -> tuple[list[dict[str, Any]], str | None]:
    raw_year: str | None = None
    if draft.answer[1] == "time" and len(draft.answer[0]) >= 4:
        raw_year = draft.answer[0][:4]
    elif draft.question_type == "age_on_date" and draft.values.get("born_on"):
        raw_year = str(draft.values["born_on"])[:4]
    if raw_year is None or not raw_year.isdigit():
        return [], NO_CLUE_RULE
    decade = f"{raw_year[:3]}0s"
    if draft.answer[1] == "time":
        matching_options = sum(
            option["value"][:3] == raw_year[:3]
            for option in question["options"]
        )
        reason = _narrowing_reason(matching_options, len(question["options"]))
        if reason:
            return [], reason
    elif draft.question_type == "age_on_date":
        reference_year = int(str(draft.values["date"])[:4])
        matching_options = sum(
            any(
                str(candidate_year).startswith(raw_year[:3])
                for candidate_year in (
                    reference_year - int(option["value"]),
                    reference_year - int(option["value"]) - 1,
                )
            )
            for option in question["options"]
        )
        reason = _narrowing_reason(matching_options, len(question["options"]))
        if reason:
            return [], reason
    text = (
        f"O fato relacionado está na década de {raw_year[:3]}0."
        if language == "pt-BR"
        else f"The related fact is from the {decade}."
    )
    clue_id = hash_payload(
        {"fact_base_ids": draft.fact_base_ids, "type": "decade", "value": decade}
    )
    return [{
        "evidence": [item.payload() for item in draft.evidence],
        "fact_base_ids": list(draft.fact_base_ids),
        "id": clue_id,
        "text": text,
        "type": "decade",
    }], None


def _narrowing_reason(matching_options: int, option_count: int) -> str | None:
    """Reject a clue that isolates the answer or rules out no option."""
    if matching_options < 2:
        return CLUE_ISOLATES_ANSWER
    if matching_options >= option_count:
        return CLUE_NOT_NARROWING
    return None


def _option_label(value: str, kind: str, language: str, entities: dict[str, Entity]) -> str:
    if kind in {"group", "person", "organization", "release", "album"}:
        return entities[value].name(language)
    if kind == "number":
        return value
    precision = 9 if len(value) == 4 else 10 if len(value) == 7 else 11
    return _format_date(value, precision, language)


def _draft_predicate(draft: Draft) -> str:
    if draft.question_type == "chronological_comparison":
        return "born_on" if draft.values["comparison_kind"] == "person" else "formed_on"
    if draft.question_type == "formation_year":
        return "formed_on"
    if draft.question_type in {"birth_date_or_place", "age_on_date"}:
        return "born_on"
    if draft.question_type in {"group_for_record_label", "record_label_for_group"}:
        return "record_label"
    if draft.question_type == "member_for_group":
        return "has_member"
    if draft.question_type in {"release_for_group", "group_for_release"}:
        return "performed_by"
    if draft.question_type == "release_year":
        return "released_on"
    if draft.question_type == "earliest_release":
        return "released_on"
    return "has_member+member_of"


def _format_date(value: str, precision: int, language: str) -> str:
    if precision == 9:
        return value[:4]
    if precision == 10:
        year, month = value.split("-")
        month_name = _MONTHS[language][int(month) - 1]
        return f"{month_name} de {year}" if language == "pt-BR" else f"{month_name} {year}"
    year, month, day = value.split("-")
    month_name = _MONTHS[language][int(month) - 1]
    numeric_day = str(int(day))
    if language == "pt-BR":
        return f"{numeric_day} de {month_name} de {year}"
    return f"{numeric_day} {month_name} {year}"


_MONTHS = {
    "pt-BR": (
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ),
    "en": (
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ),
}
