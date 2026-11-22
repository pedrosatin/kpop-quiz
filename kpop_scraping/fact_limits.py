"""Cardinality caps for the facts stage of the rebuild (ADR 052).

Each cap truncates and records the cut; the run continues. Values sit a few
times above the maxima measured on the local catalog copy of 2026-11-22 so a
normal rebuild keeps the same accepted and rejected facts.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace

from .evidence import WikipediaPage
from .facts import FactCandidate

MAX_MEMBERS_PER_GROUP = 100
MAX_MEMBERS_PER_RUN = 5000
MAX_MATCHING_NAMES = 100
MAX_INFOBOX_WIKITEXT_BYTES = 1_048_576


@dataclass(frozen=True)
class FactTruncation:
    """One cut applied while extracting or evidencing facts."""

    kind: str
    subject_id: str
    observed: int
    kept: int

    @property
    def discarded(self) -> int:
        return self.observed - self.kept


def qid_order(qid: str) -> tuple[int, str]:
    """Numeric QID order without ``int()`` (same rule as release discovery)."""
    return len(qid), qid


def cap_has_member_candidates(
    candidates: Sequence[FactCandidate],
    *,
    limit: int | None = None,
) -> tuple[tuple[FactCandidate, ...], tuple[FactTruncation, ...]]:
    """Keep at most ``limit`` ``has_member`` values per group, by ascending QID."""
    if limit is None:
        limit = MAX_MEMBERS_PER_GROUP
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    by_group: dict[str, list[FactCandidate]] = {}
    other: list[FactCandidate] = []
    for candidate in candidates:
        if candidate.predicate == "has_member" and candidate.value_id:
            by_group.setdefault(candidate.subject_id, []).append(candidate)
        else:
            other.append(candidate)
    kept: list[FactCandidate] = list(other)
    truncations: list[FactTruncation] = []
    for group_id in sorted(by_group):
        members = by_group[group_id]
        ordered = sorted(members, key=lambda c: qid_order(c.value_id or ""))
        selected = ordered[:limit]
        kept.extend(selected)
        if len(ordered) > limit:
            truncations.append(
                FactTruncation("members_per_group", group_id, len(ordered), limit)
            )
    return tuple(kept), tuple(truncations)


def cap_member_ids(
    member_qids: Sequence[str],
    *,
    limit: int | None = None,
) -> tuple[list[str], FactTruncation | None]:
    """Keep at most ``limit`` distinct member QIDs for one facts run."""
    if limit is None:
        limit = MAX_MEMBERS_PER_RUN
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    ordered = sorted(dict.fromkeys(member_qids), key=qid_order)
    if len(ordered) <= limit:
        return ordered, None
    return ordered[:limit], FactTruncation("members_per_run", "*", len(ordered), limit)


def cap_matching_names(
    names: Sequence[str],
    subject_id: str,
    *,
    limit: int | None = None,
) -> tuple[tuple[str, ...], FactTruncation | None]:
    """Keep the first ``limit`` evidence names (already ordered by ``matching_names``)."""
    if limit is None:
        limit = MAX_MATCHING_NAMES
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    ordered = tuple(names)
    if len(ordered) <= limit:
        return ordered, None
    return ordered[:limit], FactTruncation(
        "matching_names", subject_id, len(ordered), limit
    )


def cap_wikitext(
    text: str,
    subject_id: str,
    *,
    limit: int | None = None,
) -> tuple[str, FactTruncation | None]:
    """Refuse oversized wikitext for infobox evidence; return empty text when cut."""
    if limit is None:
        limit = MAX_INFOBOX_WIKITEXT_BYTES
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    size = len(text.encode("utf-8"))
    if size <= limit:
        return text, None
    return "", FactTruncation("infobox_wikitext", subject_id, size, 0)


def cap_pages_wikitext(
    pages: Mapping[str, WikipediaPage],
) -> tuple[dict[str, WikipediaPage], tuple[FactTruncation, ...]]:
    """Apply :func:`cap_wikitext` to every page used as evidence."""
    capped: dict[str, WikipediaPage] = {}
    truncations: list[FactTruncation] = []
    seen_revisions: set[int] = set()
    for key, page in pages.items():
        subject = page.wikidata_id or key
        text, truncation = cap_wikitext(page.wikitext, subject)
        if truncation is not None:
            capped[key] = replace(page, wikitext=text)
            if page.source_revision_id not in seen_revisions:
                seen_revisions.add(page.source_revision_id)
                truncations.append(truncation)
        else:
            capped[key] = page
    return capped, tuple(truncations)


def record_issues(
    store: object,
    run_id: int,
    truncations: Iterable[FactTruncation],
) -> None:
    """Persist each truncation as a ``fact_issues`` row when the store supports it."""
    record = getattr(store, "record_issue", None)
    if record is None:
        return
    for item in truncations:
        record(
            run_id,
            item.subject_id,
            f"fact_cap_{item.kind}",
            f"observed={item.observed} kept={item.kept} discarded={item.discarded}",
        )
