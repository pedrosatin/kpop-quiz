"""Render language-neutral quiz drafts into publishable questions."""

from __future__ import annotations

from datetime import date
from typing import Any

from .quiz_models import Draft, Entity, GENERATOR_VERSION
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
    return {
        "answer_option_id": answer_option_id,
        "difficulty": draft.difficulty,
        "evidence": [item.payload() for item in draft.evidence],
        "explanation": render(
            draft.question_type, language, explanation_field, **values
        ),
        "fact_base_ids": list(draft.fact_base_ids),
        "group_ids": list(draft.group_ids),
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
    if draft.question_type in {"release_for_group", "group_for_release"}:
        return "performed_by"
    if draft.question_type in {"release_year", "earliest_release"}:
        return "released_on+performed_by"
    if draft.question_type in {"birth_date_or_place", "age_on_date"}:
        return "born_on"
    if draft.question_type in {"group_for_record_label", "record_label_for_group"}:
        return "record_label"
    if draft.question_type == "member_for_group":
        return "has_member"
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
