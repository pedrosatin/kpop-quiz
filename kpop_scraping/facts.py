"""Map Wikidata statements to fact candidates for groups and people."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .entities import (
    PRECISION_DAY,
    QualifierTime,
    Statement,
    StatementIssue,
    TimeValue,
    parse_statements,
)


@dataclass(frozen=True)
class PredicateSpec:
    predicate: str
    property_ids: tuple[str, ...]
    subject_type: str
    value_kind: str
    value_entity_type: str | None
    single_valued: bool
    temporal: bool
    wikipedia_evidence: bool
    value_constraint: str | None = None


GROUP_PREDICATES = (
    PredicateSpec("formed_on", ("P571",), "group", "time", None, True, False, True),
    PredicateSpec(
        "origin_country", ("P495",), "group", "item", "place", True, False, True, "country"
    ),
    PredicateSpec("formed_in", ("P740",), "group", "item", "place", True, False, True),
    PredicateSpec("record_label", ("P264",), "group", "item", "organization", False, True, True),
    PredicateSpec("genre", ("P136",), "group", "item", "genre", False, False, True),
    PredicateSpec("has_member", ("P527",), "group", "item", "person", False, True, True),
)
# Person pages are not collected yet. Their attributes need a Wikidata reference.
PERSON_PREDICATES = (
    PredicateSpec("born_on", ("P569",), "person", "time", None, True, False, False),
    PredicateSpec("born_in", ("P19",), "person", "item", "place", True, False, False),
    PredicateSpec(
        "citizenship", ("P27",), "person", "item", "place", False, True, False, "country"
    ),
    PredicateSpec("speaks_language", ("P1412",), "person", "item", "language", False, False, False),
    PredicateSpec("plays_instrument", ("P1303",), "person", "item", "instrument", False, False, False),
    PredicateSpec("member_of", ("P463", "P361"), "person", "item", "group", False, True, True),
)
PREDICATES = {spec.predicate: spec for spec in GROUP_PREDICATES + PERSON_PREDICATES}


@dataclass(frozen=True)
class FactCandidate:
    subject_id: str
    spec: PredicateSpec
    statement: Statement
    valid_from: TimeValue | None
    valid_to: TimeValue | None
    error: str | None
    flags: tuple[str, ...]

    @property
    def predicate(self) -> str:
        return self.spec.predicate

    @property
    def value_id(self) -> str | None:
        return self.statement.item_id

    @property
    def time(self) -> TimeValue | None:
        return self.statement.time


@dataclass(frozen=True)
class ExtractedFacts:
    candidates: tuple[FactCandidate, ...]
    ignored: int
    issues: tuple[StatementIssue, ...] = ()


def group_fact_candidates(subject_id: str, entity: Mapping[str, Any]) -> ExtractedFacts:
    return _candidates(subject_id, entity, GROUP_PREDICATES, known_groups=None)


def person_fact_candidates(
    subject_id: str,
    entity: Mapping[str, Any],
    known_groups: Collection[str],
) -> ExtractedFacts:
    """Build person facts; membership keeps only links to catalog groups."""
    return _candidates(subject_id, entity, PERSON_PREDICATES, known_groups=known_groups)


def country_value_ids(candidates: Iterable[FactCandidate]) -> set[str]:
    return {
        candidate.value_id
        for candidate in candidates
        if candidate.spec.value_constraint == "country" and candidate.value_id
    }


def member_ids(candidates: Iterable[FactCandidate]) -> list[str]:
    return sorted(
        {
            candidate.value_id
            for candidate in candidates
            if candidate.predicate == "has_member" and candidate.value_id
        }
    )


def _candidates(
    subject_id: str,
    entity: Mapping[str, Any],
    specs: Iterable[PredicateSpec],
    known_groups: Collection[str] | None,
) -> ExtractedFacts:
    candidates: list[FactCandidate] = []
    issues: list[StatementIssue] = []
    ignored = 0
    for spec in specs:
        for statement in parse_statements(entity, spec.property_ids, issues):
            # Deprecated statements and unknown or empty values never become facts.
            if statement.rank == "deprecated" or statement.snaktype != "value":
                ignored += 1
                continue
            if statement.value_error is None and (
                (spec.value_kind == "item") != (statement.item_id is not None)
            ):
                ignored += 1
                continue
            if (
                spec.predicate == "member_of"
                and known_groups is not None
                and statement.item_id not in known_groups
            ):
                ignored += 1
                continue
            candidates.append(_candidate(subject_id, spec, statement))
    return ExtractedFacts(tuple(candidates), ignored, tuple(issues))


def _candidate(subject_id: str, spec: PredicateSpec, statement: Statement) -> FactCandidate:
    flags: set[str] = set()
    error = statement.value_error
    valid_from = valid_to = None
    if spec.temporal:
        valid_from, start_error = _single_time(statement.start_times, "start", flags)
        valid_to, end_error = _single_time(statement.end_times, "end", flags)
        error = error or start_error or end_error
        if spec.predicate in {"has_member", "member_of"} and not statement.start_times:
            flags.add("membership_start_unknown")
        for boundary in (valid_from, valid_to):
            if boundary is not None and boundary.precision < PRECISION_DAY:
                flags.add("validity_precision_below_day")
    if statement.time is not None and statement.time.precision < PRECISION_DAY:
        flags.add("precision_below_day")
        if spec.predicate == "born_on":
            flags.add("insufficient_precision_for_age")
    return FactCandidate(
        subject_id=subject_id,
        spec=spec,
        statement=statement,
        valid_from=valid_from,
        valid_to=valid_to,
        error=error,
        flags=tuple(sorted(flags)),
    )


def _single_time(
    values: tuple[QualifierTime, ...],
    boundary: str,
    flags: set[str],
) -> tuple[TimeValue | None, str | None]:
    if not values:
        return None, None
    if len(values) > 1:
        return None, "ambiguous_temporal_qualifiers"
    value = values[0]
    if value.snaktype == "somevalue":
        flags.add(f"{boundary}_date_unknown")
        return None, None
    if value.snaktype == "novalue":
        return None, None
    if value.error is not None:
        return None, f"invalid_{boundary}_qualifier"
    return value.time, None
