"""Paraphrase hint validation for lyrics-adjacent questions.

Hints are ungraded flavor text on existing release templates: one sentence
of plain-language gist that must never reproduce the song's expression.
This module checks new hints against the lyric sources the editor consulted
(exact search is the editor's web step; here the mechanical 3-gram slide)
and validates the review-log record that gates publication. No lyric text
is stored anywhere in this repository.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

HINT_MAX_CHARS = 140
HINT_NGRAM_WIDTH = 3
_SENTENCE_END = re.compile(r"[.!?…]+")
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_text(value: str) -> str:
    """Casefold and strip punctuation, keeping word order for n-grams."""
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(
        character if character.isalnum() else " " for character in normalized
    )


def word_tokens(value: str) -> tuple[str, ...]:
    return tuple(normalize_text(value).split())


def ngrams(tokens: tuple[str, ...], width: int = HINT_NGRAM_WIDTH) -> set[tuple[str, ...]]:
    if width < 1:
        raise ValueError("ngram width must be positive")
    if len(tokens) < width:
        return set()
    return {
        tuple(tokens[index : index + width])
        for index in range(len(tokens) - width + 1)
    }


def three_gram_overlaps(hint: str, reference: str) -> list[str]:
    """Return hint 3-grams also present in the reference lyric text."""
    hint_grams = ngrams(word_tokens(hint))
    reference_grams = ngrams(word_tokens(reference))
    return sorted(" ".join(gram) for gram in hint_grams & reference_grams)


def validate_hint(hint: str, references: list[str]) -> None:
    """Validate one paraphrase hint against consulted lyric sources.

    Raises ValueError when the hint is empty, longer than 140 characters,
    holds more than one sentence, no reference was consulted, or any
    3-gram overlaps a reference.
    """
    if not isinstance(hint, str) or not hint.strip():
        raise ValueError("hint must be a non-empty string")
    if len(hint.strip()) > HINT_MAX_CHARS:
        raise ValueError(f"hint must be at most {HINT_MAX_CHARS} characters")
    sentences = [part for part in _SENTENCE_END.split(hint.strip()) if part.strip()]
    if len(sentences) != 1:
        raise ValueError("hint must be a single sentence")
    if not references:
        raise ValueError("hint needs at least one consulted lyric reference")
    for reference in references:
        if not isinstance(reference, str):
            raise ValueError("hint references must be strings")
    for reference in references:
        overlaps = three_gram_overlaps(hint, reference)
        if overlaps:
            raise ValueError(
                f"hint reproduces {len(overlaps)} 3-gram(s) from a reference: "
                f"{overlaps[0]!r}"
            )


def validate_hint_review(record: dict[str, Any]) -> None:
    """Validate one hint review-log record.

    Required keys: hint, references_checked (non-empty list),
    exact_search_hits (int >= 0), three_gram_overlaps (list),
    second_reader and editor (non-empty), reviewed_at (YYYY-MM-DD),
    approved (bool).
    """
    if not isinstance(record, dict):
        raise ValueError(f"review must be a dictionary, got {type(record).__name__}")
    for key in (
        "hint",
        "references_checked",
        "exact_search_hits",
        "three_gram_overlaps",
        "second_reader",
        "editor",
        "reviewed_at",
        "approved",
    ):
        if key not in record:
            raise ValueError(f"review missing required field: {key}")
    validate_hint(record["hint"], record["references_checked"])
    if not isinstance(record["exact_search_hits"], int) or record["exact_search_hits"] < 0:
        raise ValueError("review exact_search_hits must be a non-negative integer")
    if not isinstance(record["three_gram_overlaps"], list):
        raise ValueError("review three_gram_overlaps must be a list")
    for key in ("second_reader", "editor"):
        if not isinstance(record[key], str) or not record[key].strip():
            raise ValueError(f"review {key} must be a non-empty string")
    reviewed_at = record["reviewed_at"]
    if not isinstance(reviewed_at, str) or not _DATE_PATTERN.match(reviewed_at):
        raise ValueError(f"review reviewed_at must be YYYY-MM-DD, got {reviewed_at!r}")
    date.fromisoformat(reviewed_at)
    if not isinstance(record["approved"], bool):
        raise ValueError("review approved must be a boolean")


def review_approves(record: dict[str, Any]) -> bool:
    """Whether a valid review record approves the hint for publication."""
    validate_hint_review(record)
    return bool(
        record["approved"]
        and record["exact_search_hits"] == 0
        and record["three_gram_overlaps"] == []
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate paraphrase hints and reviews")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="validate one hint against references")
    check.add_argument("--hint", required=True)
    check.add_argument("--reference", action="append", default=[])
    check.add_argument("--reference-file", action="append", default=[], type=Path)
    review = sub.add_parser("review", help="validate one review-log record")
    review.add_argument("--record", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "check":
            references = list(args.reference)
            for path in args.reference_file:
                references.append(path.read_text(encoding="utf-8"))
            validate_hint(args.hint, references)
            print("hint ok")
        elif args.command == "review":
            record = json.loads(args.record.read_text(encoding="utf-8"))
            validate_hint_review(record)
            print(f"review ok, approves={review_approves(record)}")
    except (ValueError, OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
