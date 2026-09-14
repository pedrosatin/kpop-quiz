"""Extract facts from directly fetched release entities."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .facts import ExtractedFacts, PredicateSpec, _candidates


EXTRACTOR_VERSION = "wikidata-release-facts-v1"
ALBUM_CLASSES = frozenset({"Q482994"})
RELEASE_CLASSES = frozenset({"Q169930", "Q134556"})
ALLOWED_CLASSES = ALBUM_CLASSES | RELEASE_CLASSES

RELEASE_PREDICATES = (
    PredicateSpec("performed_by", ("P175",), "release", "item", "group", False, False, False),
    PredicateSpec("released_on", ("P577",), "release", "time", None, True, False, False),
    PredicateSpec("release_genre", ("P136",), "release", "item", "genre", False, False, False),
)


def release_entity_type(entity: Mapping[str, Any]) -> str | None:
    claims = entity.get("claims", {})
    direct = {
        statement.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
        for statement in claims.get("P31", [])
        if statement.get("mainsnak", {}).get("snaktype") == "value"
    }
    if direct & ALBUM_CLASSES:
        return "album"
    if direct & RELEASE_CLASSES:
        return "release"
    return None


def release_fact_candidates(subject_id: str, entity: Mapping[str, Any]) -> ExtractedFacts:
    extracted = _candidates(subject_id, entity, RELEASE_PREDICATES, known_groups=None)
    candidates = []
    for candidate in extracted.candidates:
        if candidate.predicate == "released_on" and candidate.statement.qualifiers:
            candidate = type(candidate)(
                candidate.subject_id,
                candidate.spec,
                candidate.statement,
                candidate.valid_from,
                candidate.valid_to,
                "scoped_release_date",
                candidate.flags,
            )
        candidates.append(candidate)
    return ExtractedFacts(tuple(candidates), extracted.ignored, extracted.issues)
