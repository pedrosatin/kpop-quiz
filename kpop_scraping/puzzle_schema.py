"""Checks and evidence serialization shared by the puzzle artifact schemas.

Each game schema raises errors with its own prefix, so the checks take the
schema's ``_require`` as their first argument. A schema binds them once, as in
``_require_hash = partial(require_hash, _require)``, and keeps local only the
checks whose rule or message differs from these.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Callable, Iterable
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from .quiz_models import Evidence

Require = Callable[[bool, str], None]

BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")


def require_hash(_require: Require, value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_HASH_PATTERN.match(value)),
        f"{field_name} must be a 64-character lowercase hex string",
    )


def require_qid(_require: Require, value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_QID_PATTERN.match(value)),
        f"{field_name} must match pattern ^Q[1-9][0-9]*$",
    )


def require_bilingual_text(_require: Require, value: Any, field_name: str) -> None:
    _require(isinstance(value, dict), f"{field_name} must be an object")
    _require(
        set(value.keys()) == BILINGUAL_FIELDS,
        f"{field_name} fields must be pt-BR and en",
    )
    for lang in ("pt-BR", "en"):
        _require(
            isinstance(value[lang], str) and len(value[lang]) > 0,
            f"{field_name}.{lang} must be a non-empty string",
        )


def validate_evidence(_require: Require, evidence: Any, context: str) -> None:
    _require(isinstance(evidence, dict), f"{context} evidence item must be an object")
    _require(
        set(evidence.keys()) == EVIDENCE_FIELDS,
        f"{context} evidence item contains unexpected or missing fields",
    )
    _require(
        isinstance(evidence["fact_base_id"], str) and len(evidence["fact_base_id"]) > 0,
        f"{context} fact_base_id must be a non-empty string",
    )
    _require(
        isinstance(evidence["locator"], str) and len(evidence["locator"]) > 0,
        f"{context} locator must be a non-empty string",
    )
    _require(
        type(evidence["revision_id"]) is int and evidence["revision_id"] >= 1,
        f"{context} revision_id must be an integer >= 1",
    )
    _require(
        isinstance(evidence["source_key"], str) and len(evidence["source_key"]) > 0,
        f"{context} source_key must be a non-empty string",
    )
    source_url = evidence["source_url"]
    _require(
        isinstance(source_url, str) and source_url.startswith("https://"),
        f"{context} source_url must be an https URL",
    )
    parts = urlsplit(source_url)
    _require(bool(parts.netloc), f"{context} source_url netloc cannot be empty")


def serialize_evidence(evidence_items: Iterable[Evidence]) -> list[dict[str, Any]]:
    """Deduplicate and sort evidence records canonically."""
    unique: dict[tuple[str, str, int, str, str], dict[str, Any]] = {}
    for ev in evidence_items:
        key = (
            ev.fact_base_id,
            ev.locator,
            ev.revision_id,
            ev.source_key,
            ev.source_url,
        )
        if key not in unique:
            unique[key] = {
                "fact_base_id": ev.fact_base_id,
                "locator": ev.locator,
                "revision_id": ev.revision_id,
                "source_key": ev.source_key,
                "source_url": ev.source_url,
            }
    return [unique[k] for k in sorted(unique.keys())]
