"""Versioned bilingual text templates for quiz questions."""

from __future__ import annotations

from typing import Any


TEMPLATE_VERSION = "quiz-templates-v5"
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
            "prompt": "Com qual destes grupos {person} tem vínculo documentado?",
            "explanation": "A fonte documenta um vínculo entre {person} e {answer}.",
        },
        "en": {
            "prompt": "Which of these groups has a documented connection to {person}?",
            "explanation": "The source documents a connection between {person} and {answer}.",
        },
    },
    "member_for_group": {
        "pt-BR": {
            "prompt": "Qual destes artistas tem vínculo documentado com {group}?",
            "explanation": "A fonte documenta um vínculo entre {answer} e {group}.",
        },
        "en": {
            "prompt": "Which of these artists has a documented connection to {group}?",
            "explanation": "The source documents a connection between {answer} and {group}.",
        },
    },
    "group_for_record_label": {
        "pt-BR": {
            "prompt": "Qual destes grupos tem vínculo documentado com a gravadora {record_label}?",
            "explanation": "A fonte documenta um vínculo entre {answer} e a gravadora {record_label}.",
        },
        "en": {
            "prompt": "Which of these groups has a documented connection to {record_label}?",
            "explanation": "The source documents a connection between {answer} and the record label {record_label}.",
        },
    },
    "record_label_for_group": {
        "pt-BR": {
            "prompt": "Qual destas gravadoras tem vínculo documentado com {group}?",
            "explanation": "A fonte documenta um vínculo entre {group} e a gravadora {answer}.",
        },
        "en": {
            "prompt": "Which of these record labels has a documented connection to {group}?",
            "explanation": "The source documents a connection between {group} and the record label {answer}.",
        },
    },
    "chronological_comparison": {
        "pt-BR": {
            "person_prompt": "Qual destes artistas nasceu primeiro?",
            "group_prompt": "Qual destes grupos foi formado primeiro?",
            "person_explanation": "Em ordem cronológica: {comparison}.",
            "group_explanation": "Em ordem cronológica: {comparison}.",
        },
        "en": {
            "person_prompt": "Which of these artists was born first?",
            "group_prompt": "Which of these groups was formed first?",
            "person_explanation": "In chronological order: {comparison}.",
            "group_explanation": "In chronological order: {comparison}.",
        },
    },
    "release_for_group": {
        "pt-BR": {
            "prompt": "Qual destes lançamentos é de {group}?",
            "explanation": "A fonte associa {answer} a {group}.",
        },
        "en": {
            "prompt": "Which of these releases is by {group}?",
            "explanation": "The source associates {answer} with {group}.",
        },
    },
    "group_for_release": {
        "pt-BR": {
            "prompt": "Qual destes grupos lançou {release}?",
            "explanation": "A fonte associa {release} a {answer}.",
        },
        "en": {
            "prompt": "Which of these groups released {release}?",
            "explanation": "The source associates {release} with {answer}.",
        },
    },
    "release_year": {
        "pt-BR": {
            "prompt": "Em que ano {release} foi lançado?",
            "explanation": "A fonte registra o lançamento de {release} em {answer}.",
        },
        "en": {
            "prompt": "In which year was {release} released?",
            "explanation": "The source records {release} as released in {answer}.",
        },
    },
    "earliest_release": {
        "pt-BR": {
            "prompt": "Qual destes lançamentos saiu primeiro?",
            "explanation": "Em ordem cronológica: {comparison}.",
        },
        "en": {
            "prompt": "Which of these releases came out first?",
            "explanation": "In chronological order: {comparison}.",
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
