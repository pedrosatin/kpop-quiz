"""Shared value objects for deterministic quiz generation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

GENERATOR_VERSION = "quiz-generator-v9"
DEFAULT_REFERENCE_DATE = date(2026, 9, 13)


class InsufficientQuestionsError(ValueError):
    """Raised when filters leave fewer than ten questions."""


@dataclass(frozen=True)
class QuizConfig:
    language: str
    seed: str
    theme: str | None = None
    group_id: str | None = None
    play_mode: str = "standard"
    timer_seconds: int | None = None


@dataclass(frozen=True)
class Entity:
    wikidata_id: str
    entity_type: str
    canonical_name: str
    names: dict[str, str]
    aliases: tuple[str, ...] = ()

    def name(self, language: str) -> str:
        # Person and group names are identities, not translations.  Using one
        # canonical label prevents aliases and former names from changing when
        # the interface language changes.
        if self.entity_type in {"person", "group"}:
            return self.canonical_name
        preferred = "pt" if language == "pt-BR" else "en"
        fallback = "en" if preferred == "pt" else "pt"
        return self.names.get(preferred) or self.names.get(fallback) or self.canonical_name

    def identity_names(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys((self.canonical_name, *self.names.values(), *self.aliases)))


@dataclass(frozen=True)
class Evidence:
    fact_base_id: str
    source_key: str
    locator: str
    source_url: str
    revision_id: int

    def payload(self) -> dict[str, Any]:
        return {
            "fact_base_id": self.fact_base_id,
            "locator": self.locator,
            "revision_id": self.revision_id,
            "source_key": self.source_key,
            "source_url": self.source_url,
        }


@dataclass(frozen=True)
class Fact:
    statement_id: str
    subject: Entity
    predicate: str
    value_entity: Entity | None
    value_time: str | None
    value_precision: int | None
    valid_from: str | None
    valid_from_precision: int | None
    valid_to: str | None
    valid_to_precision: int | None
    flags: tuple[str, ...]
    evidence: tuple[Evidence, ...]


@dataclass(frozen=True)
class Draft:
    key: tuple[str, ...]
    question_type: str
    theme: str
    difficulty: str
    group_ids: tuple[str, ...]
    answer: tuple[str, str]
    alternatives: tuple[tuple[str, str], ...]
    values: dict[str, Any]
    evidence: tuple[Evidence, ...]
    fact_base_ids: tuple[str, ...]
