"""Schema checks and validation for timeline puzzle artifacts ("Quando foi?")."""

from __future__ import annotations

import calendar
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .quiz_schema import write_json_atomic

TIMELINE_SCHEMA_VERSION = "kpop-timeline-puzzle-v1"
TIMELINE_MIN_YEAR = 1980
TIMELINE_MAX_YEAR = 2035
TIMELINE_MIN_EVENT_GAP_DAYS = 30

TIMELINE_REQUIRED_ROOT_FIELDS = frozenset(
    {
        "schema_version",
        "puzzle_id",
        "dataset_version",
        "reference_date",
        "theme",
        "theme_description",
        "events",
    }
)

EVENT_REQUIRED_FIELDS = frozenset(
    {
        "id",
        "event_type",
        "date",
        "year",
        "display_date",
        "title",
        "description",
        "entity_id",
        "entity_name",
        "evidence",
    }
)

EVENT_TYPES = frozenset({"debut", "formation", "member_join", "disbandment", "birth"})

BILINGUAL_FIELDS = frozenset({"pt-BR", "en"})
EVIDENCE_FIELDS = frozenset(
    {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}
)

_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_QID_PATTERN = re.compile(r"^Q[1-9][0-9]*$")
_DATE_PATTERN = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"Invalid timeline puzzle schema: {message}")


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
        f"{field_name} must be a valid ISO date YYYY-MM-DD, YYYY-MM, or YYYY",
    )
    parts = value.split("-")
    year = int(parts[0])
    _require(
        TIMELINE_MIN_YEAR <= year <= TIMELINE_MAX_YEAR,
        f"{field_name} year must be between {TIMELINE_MIN_YEAR} and {TIMELINE_MAX_YEAR}",
    )
    if len(parts) >= 2:
        month = int(parts[1])
        _require(1 <= month <= 12, f"{field_name} month must be between 01 and 12")
    if len(parts) == 3:
        day = int(parts[2])
        try:
            date(year, int(parts[1]), day)
        except ValueError as exc:
            raise ValueError(f"Invalid timeline puzzle schema: {field_name} is not a valid calendar date") from exc


def timeline_date_span(date_str: str) -> tuple[date, date]:
    """Return the (earliest, latest) possible dates for a partially precise date.

    "2012" spans the whole year, "2012-06" spans the whole month, and a full
    YYYY-MM-DD date is exact. Gap guarantees are evaluated conservatively
    against these spans so partial precision cannot hide a near-simultaneous
    pair of events.
    """
    parts = date_str.split("-")
    year = int(parts[0])
    if len(parts) == 1:
        return date(year, 1, 1), date(year, 12, 31)
    month = int(parts[1])
    if len(parts) == 2:
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    return date(year, month, int(parts[2])), date(year, month, int(parts[2]))


def _require_bilingual_text(value: Any, field_name: str) -> None:
    _require(isinstance(value, dict), f"{field_name} must be an object")
    _require(set(value.keys()) == BILINGUAL_FIELDS, f"{field_name} fields must be pt-BR and en")
    for lang in ("pt-BR", "en"):
        _require(
            isinstance(value[lang], str) and len(value[lang]) > 0,
            f"{field_name}.{lang} must be a non-empty string",
        )


def _validate_evidence(evidence: Any, context: str) -> None:
    _require(isinstance(evidence, dict), f"{context} must be an object")
    _require(
        set(evidence.keys()) == EVIDENCE_FIELDS,
        f"{context} fields must be {sorted(EVIDENCE_FIELDS)}",
    )
    _require(
        isinstance(evidence["fact_base_id"], str) and len(evidence["fact_base_id"]) > 0,
        f"{context}.fact_base_id must be non-empty string",
    )
    _require(
        isinstance(evidence["locator"], str) and len(evidence["locator"]) > 0,
        f"{context}.locator must be non-empty string",
    )
    _require(
        type(evidence["revision_id"]) is int and evidence["revision_id"] > 0,
        f"{context}.revision_id must be a positive integer",
    )
    _require(
        isinstance(evidence["source_key"], str) and len(evidence["source_key"]) > 0,
        f"{context}.source_key must be non-empty string",
    )
    _require(
        isinstance(evidence["source_url"], str) and len(evidence["source_url"]) > 0,
        f"{context}.source_url must be non-empty string",
    )
    parsed = urlsplit(evidence["source_url"])
    _require(
        parsed.scheme == "https" and bool(parsed.netloc),
        f"{context}.source_url must be a valid https URL",
    )


def compute_timeline_puzzle_id(payload: dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hash for a timeline puzzle payload."""
    data = {k: v for k, v in payload.items() if k != "puzzle_id"}
    serialized = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def validate_timeline_puzzle(payload: dict[str, Any]) -> None:
    """Validate timeline puzzle against strict structural and factual rules."""
    _require(isinstance(payload, dict), "root must be an object")
    _require(
        set(payload.keys()) == TIMELINE_REQUIRED_ROOT_FIELDS,
        f"root fields must be {sorted(TIMELINE_REQUIRED_ROOT_FIELDS)}, got {sorted(payload.keys())}",
    )

    _require(
        payload["schema_version"] == TIMELINE_SCHEMA_VERSION,
        f"schema_version must be '{TIMELINE_SCHEMA_VERSION}', got '{payload['schema_version']}'",
    )

    _require_hash(payload["puzzle_id"], "puzzle_id")
    _require_hash(payload["dataset_version"], "dataset_version")
    _require_date(payload["reference_date"], "reference_date")
    _require_bilingual_text(payload["theme"], "theme")
    _require_bilingual_text(payload["theme_description"], "theme_description")

    events = payload["events"]
    _require(isinstance(events, list), "events must be an array")
    _require(4 <= len(events) <= 6, f"events must contain between 4 and 6 items, got {len(events)}")

    seen_ids: set[str] = set()
    prev_date_str: str | None = None
    prev_span_max: date | None = None
    event_years: list[int] = []
    has_year_only_date = False

    for idx, ev in enumerate(events):
        context = f"events[{idx}]"
        _require(isinstance(ev, dict), f"{context} must be an object")
        _require(
            set(ev.keys()) == EVENT_REQUIRED_FIELDS,
            f"{context} fields must be {sorted(EVENT_REQUIRED_FIELDS)}, got {sorted(ev.keys())}",
        )

        ev_id = ev["id"]
        _require(isinstance(ev_id, str) and len(ev_id) > 0, f"{context}.id must be a non-empty string")
        _require(ev_id not in seen_ids, f"{context}.id '{ev_id}' is duplicated")
        seen_ids.add(ev_id)

        _require(
            ev["event_type"] in EVENT_TYPES,
            f"{context}.event_type must be one of {sorted(EVENT_TYPES)}, got '{ev['event_type']}'",
        )

        _require_date(ev["date"], f"{context}.date")
        ev_year = ev["year"]
        _require(
            type(ev_year) is int and TIMELINE_MIN_YEAR <= ev_year <= TIMELINE_MAX_YEAR,
            f"{context}.year must be integer between {TIMELINE_MIN_YEAR} and {TIMELINE_MAX_YEAR}",
        )
        _require(int(ev["date"].split("-")[0]) == ev_year, f"{context}.year ({ev_year}) must match year in date ('{ev['date']}')")

        curr_date_str = ev["date"]
        if prev_span_max is not None:
            _require(
                curr_date_str > prev_date_str,
                f"{context}.date ('{curr_date_str}') must be strictly greater than preceding event date ('{prev_date_str}')",
            )

        # Minimum temporal distance between consecutive events, evaluated
        # conservatively over the precision spans of both dates.
        span_min, span_max = timeline_date_span(curr_date_str)
        if prev_span_max is not None:
            _require(
                (span_min - prev_span_max).days >= TIMELINE_MIN_EVENT_GAP_DAYS,
                f"{context}.date ('{curr_date_str}') must be at least {TIMELINE_MIN_EVENT_GAP_DAYS} days after "
                f"the latest possible date of the preceding event ('{prev_date_str}'), considering date precision",
            )
        prev_span_max = span_max
        prev_date_str = curr_date_str

        event_years.append(ev_year)
        if len(curr_date_str.split("-")) == 1:
            has_year_only_date = True

        _require_bilingual_text(ev["display_date"], f"{context}.display_date")
        _require_bilingual_text(ev["title"], f"{context}.title")
        _require_bilingual_text(ev["description"], f"{context}.description")
        _require_qid(ev["entity_id"], f"{context}.entity_id")
        _require(isinstance(ev["entity_name"], str) and len(ev["entity_name"]) > 0, f"{context}.entity_name must be non-empty string")

        evidence = ev["evidence"]
        _require(isinstance(evidence, list), f"{context}.evidence must be an array")
        _require(len(evidence) >= 1, f"{context}.evidence must contain at least one item")
        for ev_idx, item in enumerate(evidence):
            _validate_evidence(item, f"{context}.evidence[{ev_idx}]")

    # Year-only dates are tolerated only when every event in the round falls
    # in a distinct year.
    if has_year_only_date:
        _require(
            len(set(event_years)) == len(event_years),
            "events with year-only dates require all events to fall in distinct years",
        )


def write_timeline_puzzle_atomic(target_path: Path, payload: dict[str, Any]) -> bytes:
    """Validate and atomically write a timeline puzzle JSON file."""
    return write_json_atomic(target_path, payload, validate_timeline_puzzle)
