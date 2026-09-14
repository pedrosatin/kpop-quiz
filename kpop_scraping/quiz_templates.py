"""Versioned bilingual text templates for quiz questions."""

from __future__ import annotations

from typing import Any


TEMPLATE_VERSION = "quiz-templates-v2"
SUPPORTED_LANGUAGES = ("pt-BR", "en")


TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "formation_year": {
        "pt-BR": {
            "prompt": "Em que ano {group} foi formado?",
            "explanation": "A fonte registra a formação de {group} em {answer}.",
        },
        "en": {
            "prompt": "In which year was {group} formed?",
            "explanation": "The source records that {group} was formed in {answer}.",
        },
    },
    "member_at_date": {
        "pt-BR": {
            "prompt": "Quem fazia parte de {group} em {date}?",
            "explanation": "O intervalo documentado associa {answer} a {group} em {date}.",
        },
        "en": {
            "prompt": "Who was a member of {group} on {date}?",
            "explanation": "The documented interval associates {answer} with {group} on {date}.",
        },
    },
    "birth_date_or_place": {
        "pt-BR": {
            "prompt": "Em que data {person} nasceu?",
            "explanation": "A fonte registra o nascimento de {person} em {answer}.",
        },
        "en": {
            "prompt": "When was {person} born?",
            "explanation": "The source records {person}'s birth date as {answer}.",
        },
    },
    "age_on_date": {
        "pt-BR": {
            "prompt": "Quantos anos {person} tinha em {date}?",
            "explanation": "{person} nasceu em {born_on} e tinha {answer} anos em {date}.",
        },
        "en": {
            "prompt": "How old was {person} on {date}?",
            "explanation": "{person} was born on {born_on} and was {answer} years old on {date}.",
        },
    },
    "group_for_member": {
        "pt-BR": {
            "prompt": "Qual grupo aparece associado a {person} na afirmação citada?",
            "explanation": "A afirmação citada associa {person} a {answer}.",
        },
        "en": {
            "prompt": "Which group does the cited statement associate with {person}?",
            "explanation": "The cited statement associates {person} with {answer}.",
        },
    },
    "member_for_group": {
        "pt-BR": {
            "prompt": "Qual destes artistas a afirmação citada associa a {group}?",
            "explanation": "A afirmação citada associa {answer} a {group}.",
        },
        "en": {
            "prompt": "Which of these artists does the cited statement associate with {group}?",
            "explanation": "The cited statement associates {answer} with {group}.",
        },
    },
    "group_for_record_label": {
        "pt-BR": {
            "prompt": "Qual grupo a afirmação citada associa à gravadora {record_label}?",
            "explanation": "A afirmação citada associa {answer} à gravadora {record_label}.",
        },
        "en": {
            "prompt": "Which group does the cited statement associate with the record label {record_label}?",
            "explanation": "The cited statement associates {answer} with the record label {record_label}.",
        },
    },
    "record_label_for_group": {
        "pt-BR": {
            "prompt": "Qual gravadora a afirmação citada associa a {group}?",
            "explanation": "A afirmação citada associa {group} à gravadora {answer}.",
        },
        "en": {
            "prompt": "Which record label does the cited statement associate with {group}?",
            "explanation": "The cited statement associates {group} with the record label {answer}.",
        },
    },
    "chronological_comparison": {
        "pt-BR": {
            "person_prompt": "Qual destes artistas nasceu primeiro?",
            "group_prompt": "Qual destes grupos foi formado primeiro?",
            "person_explanation": "{answer} nasceu antes das outras alternativas, em {date}.",
            "group_explanation": "{answer} foi formado antes das outras alternativas, em {date}.",
        },
        "en": {
            "person_prompt": "Which of these artists was born first?",
            "group_prompt": "Which of these groups was formed first?",
            "person_explanation": "{answer} was born before the other options, on {date}.",
            "group_explanation": "{answer} was formed before the other options, in {date}.",
        },
    },
}


def render(question_type: str, language: str, field: str, **values: Any) -> str:
    """Render a known template without translating proper names."""
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(f"unsupported quiz language: {language}")
    try:
        template = TEMPLATES[question_type][language][field]
    except KeyError as exc:
        raise ValueError(
            f"unknown template field: {question_type}/{language}/{field}"
        ) from exc
    return template.format(**values)
