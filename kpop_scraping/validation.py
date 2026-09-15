"""Decide fact status from rank, value quality, conflicts and evidence."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace

from .evidence import EvidenceItem, WikipediaPage, assess_references, text_evidence
from .facts import FactCandidate


ACCEPTED = "accepted"
REJECTED = "rejected"
CONFLICT = "conflict"
SUPERSEDED = "superseded"
STALE = "stale"
EVIDENCE_REASONS = frozenset(
    {"missing_evidence", "unreliable_reference_source", "unreviewed_reference_source"}
)


@dataclass(frozen=True)
class ValidationContext:
    names: Mapping[str, tuple[str, ...]]
    entity_types: Mapping[str, str]
    group_pages: Mapping[str, WikipediaPage]
    release_pages: Mapping[str, tuple[WikipediaPage, ...]] = field(default_factory=dict)
    release_performers: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    countries: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class FactDecision:
    candidate: FactCandidate
    status: str
    reason: str | None
    flags: tuple[str, ...]
    evidence: tuple[EvidenceItem, ...]


def find_evidence(
    candidate: FactCandidate,
    context: ValidationContext,
) -> tuple[tuple[EvidenceItem, ...], str]:
    """Return evidence and, when there is none, the rejection reason.

    Reliable Wikidata references come first. Group facts and memberships may
    fall back to the collected Wikipedia revision of the group.
    """
    assessment = assess_references(candidate.statement)
    reason = assessment.rejection_reason or "missing_evidence"
    if assessment.evidence or not candidate.spec.wikipedia_evidence:
        return assessment.evidence, reason
    predicate = candidate.predicate
    group_id = candidate.value_id if predicate == "member_of" else candidate.subject_id
    if candidate.spec.subject_type == "release":
        pages = context.release_pages.get(group_id or "", ())
    else:
        page = context.group_pages.get(group_id or "")
        pages = (page,) if page else ()
    if not pages:
        return (), reason
    person_or_value = candidate.subject_id if predicate == "member_of" else candidate.value_id
    for page in pages:
        item = text_evidence(
            predicate,
            page,
            context.names.get(group_id or "", ()),
            context.names.get(person_or_value or "", ()),
            candidate.time,
            context.release_performers.get(group_id or "", ()),
        )
        if item:
            return (item,), reason
    return (), reason


def validate_facts(
    candidates: Iterable[FactCandidate],
    context: ValidationContext,
    reference_candidates: Iterable[FactCandidate] = (),
) -> list[FactDecision]:
    """Validate candidates; reference candidates only inform membership checks.

    A limited run can process a person whose other group is outside the limit.
    The pipeline passes that group's P527 statements as reference candidates so
    both sides of the membership are compared in every run.
    """
    ordered = list(candidates)
    groups: dict[tuple[str, str], list[FactCandidate]] = {}
    for candidate in ordered:
        groups.setdefault((candidate.subject_id, candidate.predicate), []).append(candidate)
    decisions: dict[str, FactDecision] = {}
    for group in groups.values():
        for decision in _validate_group(group, context):
            decisions[decision.candidate.statement.statement_id] = decision
    _cross_check_memberships(decisions, list(reference_candidates))
    return [decisions[candidate.statement.statement_id] for candidate in ordered]


def _validate_group(
    group: list[FactCandidate],
    context: ValidationContext,
) -> list[FactDecision]:
    spec = group[0].spec
    results: dict[str, FactDecision] = {}
    evidence: dict[str, tuple[EvidenceItem, ...]] = {}
    evidence_reason: dict[str, str] = {}

    def decide(candidate: FactCandidate, status: str, reason: str | None) -> None:
        found = evidence.get(candidate.statement.statement_id, ())
        flags = set(candidate.flags)
        if found and (candidate.valid_from or candidate.valid_to):
            flags.add("validity_not_evidenced")
        results[candidate.statement.statement_id] = FactDecision(
            candidate, status, reason, tuple(sorted(flags)), found
        )

    preferred_properties = _preferred_properties(group)
    active: list[FactCandidate] = []
    for candidate in group:
        value_type = context.entity_types.get(candidate.value_id or "")
        if (
            candidate.statement.rank == "normal"
            and candidate.statement.property_id in preferred_properties
        ):
            decide(candidate, SUPERSEDED, "preferred_rank_exists")
        elif candidate.error:
            decide(candidate, REJECTED, candidate.error)
        elif spec.value_kind == "item" and value_type is None:
            decide(candidate, REJECTED, "value_entity_missing")
        elif spec.value_entity_type in {"person", "group"} and value_type != spec.value_entity_type:
            decide(candidate, REJECTED, f"value_not_{spec.value_entity_type}")
        elif spec.value_constraint == "country" and candidate.value_id not in context.countries:
            decide(candidate, REJECTED, "value_not_country")
        else:
            active.append(candidate)

    for candidate in active:
        found, reason = find_evidence(candidate, context)
        evidence[candidate.statement.statement_id] = found
        evidence_reason[candidate.statement.statement_id] = reason

    def preference(candidate: FactCandidate) -> tuple:
        precision = candidate.time.precision if candidate.time else 0
        dated = int(bool(candidate.valid_from or candidate.valid_to))
        return (
            not evidence[candidate.statement.statement_id],
            -dated,
            -precision,
            candidate.statement.statement_id,
        )

    survivors: list[FactCandidate] = []
    by_value: dict[str, list[FactCandidate]] = {}
    for candidate in active:
        by_value.setdefault(_value_key(candidate), []).append(candidate)
    for items in by_value.values():
        if spec.temporal:
            dated = [item for item in items if item.valid_from or item.valid_to]
            undated = [item for item in items if not (item.valid_from or item.valid_to)]
            if dated:
                for item in undated:
                    decide(item, SUPERSEDED, "duplicate_value")
                items = dated
        by_period: dict[tuple, list[FactCandidate]] = {}
        for item in items:
            by_period.setdefault(_period_key(item), []).append(item)
        for same in by_period.values():
            best, *duplicates = sorted(same, key=preference)
            survivors.append(best)
            for item in duplicates:
                decide(item, SUPERSEDED, "duplicate_value")

    if spec.single_valued and len(survivors) > 1:
        refinable = spec.value_kind == "time" and all(
            first.time.compatible_with(second.time)
            for first in survivors
            for second in survivors
        )
        if refinable:
            best, *others = sorted(survivors, key=preference)
            for item in others:
                decide(item, SUPERSEDED, "duplicate_value")
            survivors = [best]
        else:
            for item in survivors:
                decide(item, CONFLICT, "same_rank_values_differ")
            survivors = []

    for candidate in survivors:
        statement_id = candidate.statement.statement_id
        if evidence[statement_id]:
            decide(candidate, ACCEPTED, None)
        else:
            decide(candidate, REJECTED, evidence_reason[statement_id])
    return [results[candidate.statement.statement_id] for candidate in group]


def _preferred_properties(candidates: Iterable[FactCandidate]) -> set[str]:
    """Wikidata ranks compete inside one property, so P463 and P361 stay apart."""
    return {
        candidate.statement.property_id
        for candidate in candidates
        if candidate.statement.rank == "preferred"
    }


def _value_key(candidate: FactCandidate) -> str:
    if candidate.value_id is not None:
        return candidate.value_id
    return candidate.time.value if candidate.time else ""


def _period_key(candidate: FactCandidate) -> tuple:
    return (
        candidate.valid_from.value if candidate.valid_from else None,
        candidate.valid_to.value if candidate.valid_to else None,
    )


@dataclass
class _Side:
    candidate: FactCandidate
    decision_id: str | None


def _cross_check_memberships(
    decisions: dict[str, FactDecision],
    reference_candidates: list[FactCandidate],
) -> None:
    """Compare P527 on the group with P463/P361 on the person.

    A membership is eligible only when P527 and P463/P361 both describe it.
    Incompatible dates become ``membership_period_mismatch``. A boundary found
    on one side only becomes ``membership_period_unconfirmed``. In particular,
    a missing P582 does not prove that the membership is current.
    """
    pairs: dict[tuple[str, str], tuple[list[_Side], list[_Side]]] = {}

    def add(candidate: FactCandidate, decision_id: str | None) -> None:
        if candidate.value_id is None:
            return
        if candidate.predicate == "has_member":
            key = (candidate.subject_id, candidate.value_id)
            pairs.setdefault(key, ([], []))[0].append(_Side(candidate, decision_id))
        elif candidate.predicate == "member_of":
            key = (candidate.value_id, candidate.subject_id)
            pairs.setdefault(key, ([], []))[1].append(_Side(candidate, decision_id))

    for statement_id, decision in decisions.items():
        if decision.status == ACCEPTED or (
            decision.status == REJECTED and decision.reason in EVIDENCE_REASONS
        ):
            add(decision.candidate, statement_id)
    known = set(decisions)
    references = [c for c in reference_candidates if c.statement.statement_id not in known]
    preferred = _preferred_properties(references)
    for candidate in references:
        if candidate.error is None and not (
            candidate.statement.rank == "normal"
            and candidate.statement.property_id in preferred
        ):
            add(candidate, None)

    mismatched: set[str] = set()
    unconfirmed: set[str] = set()
    unverified: set[str] = set()
    for group_side, person_side in pairs.values():
        if not group_side or not person_side:
            for entry in group_side + person_side:
                if (
                    entry.decision_id
                    and decisions[entry.decision_id].status == ACCEPTED
                ):
                    unverified.add(entry.decision_id)
            continue
        for side, others in ((group_side, person_side), (person_side, group_side)):
            for entry in side:
                matches = [other for other in others if _compatible(entry, other)]
                if not matches:
                    if entry.decision_id:
                        mismatched.add(entry.decision_id)
                    continue
                best = max(matches, key=lambda other: _shared_boundaries(entry, other))
                if _asymmetric(entry, best):
                    for item in (entry, best):
                        if item.decision_id:
                            unconfirmed.add(item.decision_id)

    for statement_id in mismatched:
        decisions[statement_id] = replace(
            decisions[statement_id], status=CONFLICT, reason="membership_period_mismatch"
        )
    for statement_id in unconfirmed - mismatched:
        decisions[statement_id] = replace(
            decisions[statement_id],
            status=CONFLICT,
            reason="membership_period_unconfirmed",
        )
    for statement_id in unverified - mismatched - unconfirmed:
        decisions[statement_id] = replace(
            decisions[statement_id],
            status=CONFLICT,
            reason="membership_counterpart_unverified",
        )


def _boundaries(side: _Side) -> tuple:
    return side.candidate.valid_from, side.candidate.valid_to


def _compatible(first: _Side, second: _Side) -> bool:
    for mine, theirs in zip(_boundaries(first), _boundaries(second)):
        if mine is not None and theirs is not None and not mine.compatible_with(theirs):
            return False
    return True


def _shared_boundaries(first: _Side, second: _Side) -> int:
    return sum(
        mine is not None and theirs is not None
        for mine, theirs in zip(_boundaries(first), _boundaries(second))
    )


def _asymmetric(first: _Side, second: _Side) -> bool:
    return any(
        (mine is None) != (theirs is None)
        for mine, theirs in zip(_boundaries(first), _boundaries(second))
    )
