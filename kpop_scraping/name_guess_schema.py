"""Schema checks and validation for name guess puzzle artifacts."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .quiz_schema import write_json_atomic

NAME_GUESS_SCHEMA_VERSION = "kpop-name-guess-puzzle-v1"

NAME_GUESS_ROOT_FIELDS = frozenset(
    {
        "schema_version",
        "puzzle_id",
        "dataset_version",
        "reference_date",
        "word_length",
        "max_attempts",
        "target",
        "valid_guesses",
    }
)

TARGET_REQUIRED_FIELDS = frozenset(
    {
        "id",
        "canonical_name",
        "normalized_name",
        "labels",
        "entity_type",
        "evidence",
    }
)

TARGET_ALL_FIELDS = TARGET_REQUIRED_FIELDS | frozenset({"clues"})

CLUES_ALLOWED_FIELDS = frozenset(
    {"debut_year", "agency", "members_count", "description"}
)

BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NORMALIZED_NAME_PATTERN = re.compile(r"^[A-Z]+$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid name guess puzzle schema: {message}")


def _require_hash(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_HASH_PATTERN.match(value)),
        f"{field_name} must be a 64-character lowercase hex string",
    )


def _require_qid(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_QID_PATTERN.match(value)),
        f"{field_name} must match pattern ^Q[1-9][0-9]*$",
    )


def _require_date(value: Any, field_name: str) -> None:
    _require(
        isinstance(value, str) and bool(_DATE_PATTERN.match(value)),
        f"{field_name} must be a valid ISO date YYYY-MM-DD",
    )
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"Invalid name guess puzzle schema: {field_name} is not a calendar date"
        ) from exc


def _require_bilingual_text(value: Any, field_name: str) -> None:
    _require(isinstance(value, dict), f"{field_name} must be an object")
    _require(set(value.keys()) == BILINGUAL_FIELDS, f"{field_name} fields must be pt-BR and en")
    for lang in ("pt-BR", "en"):
        _require(
            isinstance(value[lang], str) and len(value[lang]) > 0,
            f"{field_name}.{lang} must be a non-empty string",
        )


def _validate_evidence(evidence: Any, context: str) -> None:
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


def normalize_name(name: str) -> str:
    """Normalize a display name to uppercase ASCII alphabetic characters.

    Strips accents via NFKD decomposition, removes punctuation, symbols, and spaces,
    and returns uppercase letters [A-Z].
    """
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c.upper() for c in decomposed if "A" <= c.upper() <= "Z")


def compute_guess_feedback(target: str, guess: str) -> list[str]:
    """Compute positional feedback ('correct', 'present', 'absent') for a guess.

    Implements a strict two-pass algorithm to handle duplicate letters accurately.
    Both target and guess must be uppercase strings of the same non-empty length.
    """
    if not isinstance(target, str) or not isinstance(guess, str):
        raise ValueError("Target and guess must be string instances")
    if len(target) != len(guess):
        raise ValueError(
            f"Target length ({len(target)}) and guess length ({len(guess)}) must match"
        )
    if not target or not target.isalpha() or not target.isupper():
        raise ValueError("Target must be a non-empty uppercase alphabetic string")
    if not guess or not guess.isalpha() or not guess.isupper():
        raise ValueError("Guess must be a non-empty uppercase alphabetic string")

    n = len(target)
    result: list[str | None] = [None] * n
    letter_counts: Counter[str] = Counter(target)

    # Pass 1: exact matches (correct)
    for i in range(n):
        if guess[i] == target[i]:
            result[i] = "correct"
            letter_counts[guess[i]] -= 1

    # Pass 2: letters present elsewhere or absent
    for i in range(n):
        if result[i] is None:
            g_char = guess[i]
            if letter_counts[g_char] > 0:
                result[i] = "present"
                letter_counts[g_char] -= 1
            else:
                result[i] = "absent"

    return [str(status) for status in result]


def generate_share_summary(
    reference_date: str,
    attempts: list[list[str]],
    won: bool,
    max_attempts: int = 6,
    high_contrast: bool = False,
) -> str:
    """Generate text share summary with block emojis."""
    score_text = f"{len(attempts)}/{max_attempts}" if won else f"X/{max_attempts}"
    lines = [f"K-pop Guess {reference_date} {score_text}", ""]

    emoji_map = {
        "correct": "🟦" if high_contrast else "🟩",
        "present": "🟧" if high_contrast else "🟨",
        "absent": "⬛",
    }

    for attempt in attempts:
        row = "".join(emoji_map.get(status, "⬛") for status in attempt)
        lines.append(row)

    return "\n".join(lines)


def validate_name_guess_puzzle(payload: dict[str, Any]) -> None:
    """Validate that payload conforms to kpop-name-guess-puzzle-v1 specification.

    Raises ValueError when the payload is invalid.
    """
    _require(isinstance(payload, dict), "root payload must be an object")
    _require(
        set(payload.keys()) == NAME_GUESS_ROOT_FIELDS,
        f"root payload has missing or extra fields: {sorted(set(payload.keys()) ^ NAME_GUESS_ROOT_FIELDS)}",
    )
    _require(
        payload["schema_version"] == NAME_GUESS_SCHEMA_VERSION,
        f"schema_version must be {NAME_GUESS_SCHEMA_VERSION}",
    )
    _require_hash(payload["puzzle_id"], "puzzle_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")

    # Word length
    word_length = payload["word_length"]
    _require(
        type(word_length) is int and 3 <= word_length <= 10,
        "word_length must be an integer between 3 and 10",
    )

    # Max attempts
    max_attempts = payload["max_attempts"]
    _require(
        type(max_attempts) is int and 4 <= max_attempts <= 8,
        "max_attempts must be an integer between 4 and 8",
    )

    # Target
    target = payload["target"]
    _require(isinstance(target, dict), "target must be an object")
    _require(
        TARGET_REQUIRED_FIELDS.issubset(set(target.keys()))
        and set(target.keys()).issubset(TARGET_ALL_FIELDS),
        f"target has missing or unexpected fields: {sorted(set(target.keys()) ^ TARGET_ALL_FIELDS)}",
    )
    _require_qid(target["id"], "target.id")
    _require(
        isinstance(target["canonical_name"], str) and len(target["canonical_name"]) > 0,
        "target.canonical_name must be a non-empty string",
    )
    normalized_name = target["normalized_name"]
    _require(
        isinstance(normalized_name, str)
        and bool(_NORMALIZED_NAME_PATTERN.match(normalized_name)),
        "target.normalized_name must be an uppercase string matching ^[A-Z]+$",
    )
    _require(
        len(normalized_name) == word_length,
        f"target.normalized_name length ({len(normalized_name)}) does not match word_length ({word_length})",
    )
    _require_bilingual_text(target["labels"], "target.labels")
    _require(
        target["entity_type"] in {"group", "person"},
        "target.entity_type must be either 'group' or 'person'",
    )

    # Clues (optional)
    if "clues" in target:
        clues = target["clues"]
        _require(isinstance(clues, dict), "target.clues must be an object")
        _require(
            set(clues.keys()).issubset(CLUES_ALLOWED_FIELDS),
            f"target.clues contains unexpected fields: {sorted(set(clues.keys()) - CLUES_ALLOWED_FIELDS)}",
        )
        if "debut_year" in clues:
            debut_year = clues["debut_year"]
            _require(
                type(debut_year) is int and 1900 <= debut_year <= 2100,
                "target.clues.debut_year must be an integer between 1900 and 2100",
            )
        if "agency" in clues:
            agency = clues["agency"]
            if isinstance(agency, dict):
                _require_bilingual_text(agency, "target.clues.agency")
            else:
                _require(
                    isinstance(agency, str) and len(agency) > 0,
                    "target.clues.agency must be a non-empty string or bilingual object",
                )
        if "members_count" in clues:
            members_count = clues["members_count"]
            _require(
                type(members_count) is int and 1 <= members_count <= 50,
                "target.clues.members_count must be an integer between 1 and 50",
            )
        if "description" in clues:
            _require_bilingual_text(clues["description"], "target.clues.description")

    # Evidence
    ev_list = target["evidence"]
    _require(isinstance(ev_list, list), "target.evidence must be a list")
    _require(len(ev_list) >= 1, "target.evidence must contain at least one evidence item")
    for ev_idx, ev in enumerate(ev_list):
        _validate_evidence(ev, f"target.evidence[{ev_idx}]")

    # Valid guesses
    valid_guesses = payload["valid_guesses"]
    _require(isinstance(valid_guesses, list), "valid_guesses must be a list")
    _require(len(valid_guesses) >= 1, "valid_guesses must contain at least one guess")

    for idx, guess in enumerate(valid_guesses):
        _require(
            isinstance(guess, str)
            and len(guess) == word_length
            and bool(_NORMALIZED_NAME_PATTERN.match(guess)),
            f"valid_guesses[{idx}] ('{guess}') must be an uppercase string matching ^[A-Z]{{{word_length}}}$",
        )

    _require(
        len(valid_guesses) == len(set(valid_guesses)),
        "valid_guesses contains duplicate words",
    )

    _require(
        normalized_name in valid_guesses,
        f"target.normalized_name ('{normalized_name}') must be in valid_guesses",
    )


def write_name_guess_puzzle_atomic(target_path: Path, payload: dict[str, Any]) -> bytes:
    """Validate and atomically write a name guess puzzle JSON file."""
    return write_json_atomic(target_path, payload, validate_name_guess_puzzle)
