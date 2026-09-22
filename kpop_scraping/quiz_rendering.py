"""Render language-neutral quiz drafts into publishable questions."""

from __future__ import annotations

from datetime import date
from typing import Any

from .quiz_drafts import _membership_contains_date
from .quiz_models import Draft, Entity, Fact, GENERATOR_VERSION
from .quiz_templates import render
from .quiz_utils import digest, hash_payload


def _render_draft(
    draft: Draft,
    language: str,
    reference_date: date,
    entities: dict[str, Entity],
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
    return base_question


def render_play_mode_variants(
    draft: Draft,
    language: str,
    reference_date: date,
    entities: dict[str, Entity],
    person_memberships: dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]],
) -> list[dict[str, Any]]:
    """Render reproducible play modes without changing the underlying answer."""
    base = _render_draft(draft, language, reference_date, entities)
    clues = _temporal_clues(draft, language, base)
    raw_date = draft.values.get("date") if draft.question_type == "member_at_date" else None
    on_date = raw_date if isinstance(raw_date, str) else None
    variants = []
    for play_mode, points in (("assisted", 70), ("standard", 100), ("expert", 130)):
        question = dict(base)
        question["play_mode"] = play_mode
        question["base_points"] = points
        question["hint_cost"] = 0 if play_mode == "assisted" else 15
        question["clues_available"] = [] if play_mode == "expert" else clues
        question["clues_shown"] = [clues[0]["id"]] if play_mode == "assisted" and clues else []
        if play_mode == "assisted":
            question["options"] = _add_group_labels_to_people(
                question["options"], language, entities, person_memberships, on_date
            )
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
    on_date: str | None,
) -> list[dict[str, str]]:
    """Append sourced group names. A dated membership question uses that date."""
    labeled_options = []
    for option in options:
        group_ids = _groups_for_label(person_memberships, option["value"], on_date)
        if option["value_type"] != "person" or not group_ids:
            labeled_options.append(option)
            continue
        groups = " · ".join(entities[group_id].name(language) for group_id in group_ids)
        labeled_options.append({**option, "label": f"{option['label']} ({groups})"})
    return labeled_options


def _groups_for_label(
    person_memberships: dict[str, tuple[tuple[str, tuple[Fact, ...]], ...]],
    person_id: str,
    on_date: str | None,
) -> tuple[str, ...]:
    pairs = person_memberships.get(person_id, ())
    if on_date is None:
        return tuple(group_id for group_id, _pair_facts in pairs)
    return tuple(
        group_id
        for group_id, pair_facts in pairs
        if _membership_contains_date(pair_facts, on_date)
    )


def _temporal_clues(
    draft: Draft, language: str, question: dict[str, Any]
) -> list[dict[str, Any]]:
    raw_year: str | None = None
    if draft.answer[1] == "time" and len(draft.answer[0]) >= 4:
        raw_year = draft.answer[0][:4]
    elif draft.question_type == "age_on_date" and draft.values.get("born_on"):
        raw_year = str(draft.values["born_on"])[:4]
    if raw_year is None or not raw_year.isdigit():
        return []
    decade = f"{raw_year[:3]}0s"
    if draft.answer[1] == "time":
        matching_options = sum(
            option["value"][:3] == raw_year[:3]
            for option in question["options"]
        )
        if matching_options < 2 or matching_options >= len(question["options"]):
            return []
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
        if matching_options < 2 or matching_options >= len(question["options"]):
            return []
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
    }]


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
