"""Keep the facts the person-infobox rule accepted when a run collects no person pages.

ADR 027 makes the rule opt-in: a run without a person client never fetches a
page and never accepts a new fact from this source. Facts are rewritten by
every run, though, so a run that simply skipped the rule would turn each fact
the rule had accepted into ``missing_evidence``. This module replays the rule
for those facts only, from the revision and wikitext already stored, without
the network. When it cannot, the run fails instead of downgrading.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass

from .evidence import WikipediaPage
from .facts import FactCandidate
from .fact_store import FactStore
from .person_evidence import PERSON_BIRTH_FIELDS
from .storage import SnapshotIntegrityError
from .validation import (
    EVIDENCE_REASONS,
    PAGE_CONTRADICTION_REASONS,
    REJECTED,
    FactDecision,
)

# A fact accepted by the rule keeps a revision of the person's own page as evidence.
_PERSON_EVIDENCE_TYPE = "wikipedia_revision"
_LOSS_REASONS = EVIDENCE_REASONS | PAGE_CONTRADICTION_REASONS

ValueKey = tuple[str | None, int | None, str | None, str | None]


class PersonEvidenceUnavailable(RuntimeError):
    """The stored evidence of a fact the rule accepted cannot be replayed."""


@dataclass(frozen=True)
class PreservedFact:
    statement_id: str
    subject_qid: str
    predicate: str
    source_revision_id: int
    value: ValueKey


def value_key(candidate: FactCandidate) -> ValueKey:
    """The part of a candidate that the infobox evidence vouches for."""
    time = candidate.time
    return (
        time.value if time else None,
        time.precision if time else None,
        time.calendar if time else None,
        candidate.value_id,
    )


def facts_with_person_evidence(connection: sqlite3.Connection) -> list[PreservedFact]:
    """Birth facts whose stored evidence is a revision of the person's own page."""
    rows = connection.execute(
        """
        SELECT DISTINCT f.statement_id, e.wikidata_id, f.predicate,
               fe.source_revision_id, f.value_time, f.value_precision,
               f.value_calendar, f.value_wikidata_id
        FROM facts f
        JOIN entities e ON e.id = f.subject_entity_id
        JOIN fact_evidence fe ON fe.fact_id = f.id
        WHERE f.predicate IN ('born_on', 'born_in')
          AND fe.evidence_type = ? AND fe.source_revision_id IS NOT NULL
        ORDER BY f.statement_id
        """,
        (_PERSON_EVIDENCE_TYPE,),
    ).fetchall()
    return [
        PreservedFact(
            row["statement_id"],
            row["wikidata_id"],
            row["predicate"],
            int(row["source_revision_id"]),
            (
                row["value_time"],
                row["value_precision"],
                row["value_calendar"],
                row["value_wikidata_id"],
            ),
        )
        for row in rows
        if row["predicate"] in PERSON_BIRTH_FIELDS
    ]


def load_preserved_pages(
    store: FactStore, preserved: Iterable[PreservedFact]
) -> dict[str, WikipediaPage]:
    """Rebuild, from the stored revision, the page that evidenced each person's facts."""
    revisions: dict[str, int] = {}
    for fact in preserved:
        known = revisions.setdefault(fact.subject_qid, fact.source_revision_id)
        if known != fact.source_revision_id:
            raise PersonEvidenceUnavailable(
                f"{fact.subject_qid} has facts evidenced by two page revisions "
                f"({known} and {fact.source_revision_id}); run with --person-evidence "
                "to settle them against one revision"
            )
    return {
        qid: _stored_page(store, qid, revision_id)
        for qid, revision_id in sorted(revisions.items())
    }


def _stored_page(store: FactStore, qid: str, source_revision_id: int) -> WikipediaPage:
    row = store.connection.execute(
        """
        SELECT sr.external_revision_id, sp.external_page_id, sp.title, sp.language,
               sp.wikidata_id, sp.is_redirect
        FROM source_revisions sr JOIN source_pages sp ON sp.id = sr.source_page_id
        WHERE sr.id = ?
        """,
        (source_revision_id,),
    ).fetchone()
    if row is None:
        raise PersonEvidenceUnavailable(
            f"the revision {source_revision_id} that evidences {qid} is not stored"
        )
    try:
        wikitext = store.revision_wikitext(source_revision_id)
    except (SnapshotIntegrityError, OSError, ValueError) as exc:
        raise PersonEvidenceUnavailable(
            f"the wikitext of revision {source_revision_id} that evidences {qid} "
            f"cannot be read: {exc}"
        ) from exc
    if not wikitext:
        raise PersonEvidenceUnavailable(
            f"the wikitext of revision {source_revision_id} that evidences {qid} is not stored"
        )
    return WikipediaPage(
        source_revision_id,
        row["language"],
        int(row["external_page_id"]),
        int(row["external_revision_id"]),
        "",
        row["title"],
        wikitext,
        row["wikidata_id"] or "",
        bool(row["is_redirect"]),
    )


def assert_none_downgraded(
    preserved: Sequence[PreservedFact],
    decisions: Mapping[str, FactDecision],
) -> None:
    """Fail when a fact the rule accepted, with the same value, lost its evidence.

    A fact whose Wikidata value changed or that left Wikidata is a different
    fact and falls outside the guarantee, as does a fact that became a conflict
    or was superseded by another statement.
    """
    lost = [
        fact.statement_id
        for fact in preserved
        if (decision := decisions.get(fact.statement_id)) is not None
        and value_key(decision.candidate) == fact.value
        and decision.status == REJECTED
        and decision.reason in _LOSS_REASONS
    ]
    if lost:
        raise PersonEvidenceUnavailable(
            f"{len(lost)} facts accepted by the person infobox would lose their "
            f"evidence without --person-evidence (first: {', '.join(lost[:3])}); "
            "no fact was changed"
        )


def restrict_to(
    preserved: Iterable[PreservedFact], subjects: Collection[str]
) -> list[PreservedFact]:
    """Keep the facts of the people this run processes."""
    return [fact for fact in preserved if fact.subject_qid in subjects]
