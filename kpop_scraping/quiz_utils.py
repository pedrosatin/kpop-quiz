"""Deterministic hashing helpers shared by quiz modules."""

from __future__ import annotations

import hashlib
import unicodedata
from collections import defaultdict
from datetime import datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .storage import canonical_json

if TYPE_CHECKING:
    from .quiz_models import Fact


def hash_payload(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


REFERENCE_TIMEZONE = "America/Sao_Paulo"


class ReferenceTimezoneError(RuntimeError):
    """The reference time zone is missing from the environment."""


def reference_date_today() -> str:
    """Return today as ISO YYYY-MM-DD in America/Sao_Paulo.

    A missing time zone raises instead of falling back to UTC, which would
    publish the next day between 21:00 and midnight in Sao Paulo.
    """
    try:
        zone = ZoneInfo(REFERENCE_TIMEZONE)
    except ZoneInfoNotFoundError as exc:
        raise ReferenceTimezoneError(
            f"time zone {REFERENCE_TIMEZONE} is unavailable; install the tzdata package "
            "or the system time zone database, or pass an explicit date"
        ) from exc
    return datetime.now(zone).date().isoformat()


def display_key(label: str) -> str:
    """Normalize a displayed label so look-alike titles share one key."""
    normalized = unicodedata.normalize("NFKC", label).casefold()
    return "".join(
        character for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def ambiguous_release_ids(facts: "list[Fact]") -> set[str]:
    """Ids of album/release subjects whose displayed title, in any language, is shared."""
    releases = {
        fact.subject.wikidata_id: fact.subject
        for fact in facts
        if fact.subject.entity_type in {"release", "album"}
    }
    ambiguous: set[str] = set()
    for language in ("pt-BR", "en"):
        ids_by_label: dict[str, set[str]] = defaultdict(set)
        for qid, release in releases.items():
            ids_by_label[display_key(release.name(language))].add(qid)
        ambiguous.update(
            qid for ids in ids_by_label.values() if len(ids) > 1 for qid in ids
        )
    return ambiguous
