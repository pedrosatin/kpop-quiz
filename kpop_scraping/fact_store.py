"""SQLite persistence for Wikidata entity snapshots, entities and facts."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from .entities import Alias, canonical_name, extract_aliases
from .evidence import WikipediaPage
from .sources import SOURCE_POLICY_VERSION, classify_source
from .storage import Repository, SnapshotIntegrityError, canonical_json, utc_now
from .validation import ACCEPTED, CONFLICT, REJECTED, STALE, SUPERSEDED, FactDecision
from .wikidata import SUBJECT_PROFILE, EntityDocument


SUBJECT_ENTITY_TYPES = frozenset({"group", "person"})


@dataclass(frozen=True)
class CatalogGroup:
    wikidata_id: str
    source_page_id: int
    source_revision_id: int
    title: str


@dataclass(frozen=True)
class FactRunTotals:
    groups: int
    entities: int
    batches: int
    accepted: int
    rejected: int
    conflict: int
    superseded: int
    ignored: int
    stale: int = 0


class FactStore:
    """Repository methods for the fact stage, sharing the catalog connection."""

    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.connection = repository.connection

    def start_run(self, extractor_version: str, group_limit: int | None) -> int:
        cursor = self.connection.execute(
            """
            INSERT INTO fact_runs(
                extractor_version, source_policy_version, started_at, status, group_limit
            ) VALUES (?, ?, ?, 'running', ?)
            """,
            (extractor_version, SOURCE_POLICY_VERSION, utc_now(), group_limit),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def complete_run(self, run_id: int, totals: FactRunTotals) -> None:
        self.connection.execute(
            """
            UPDATE fact_runs
            SET completed_at=?, status='completed', groups_processed=?,
                entities_saved=?, wikidata_batches=?, facts_accepted=?,
                facts_rejected=?, facts_conflict=?, facts_superseded=?,
                facts_stale=?, statements_ignored=?
            WHERE id=?
            """,
            (
                utc_now(),
                totals.groups,
                totals.entities,
                totals.batches,
                totals.accepted,
                totals.rejected,
                totals.conflict,
                totals.superseded,
                totals.stale,
                totals.ignored,
                run_id,
            ),
        )
        self.connection.commit()

    def fail_run(self, run_id: int, error: str) -> None:
        self.connection.rollback()
        self.connection.execute(
            "UPDATE fact_runs SET completed_at=?, status='failed', error=? WHERE id=?",
            (utc_now(), error[:1000], run_id),
        )
        self.connection.commit()

    def accepted_groups(self, limit: int | None = None) -> list[CatalogGroup]:
        rows = self.connection.execute(
            """
            SELECT ce.analyzed_wikidata_id AS wikidata_id, ce.source_page_id,
                   ce.source_revision_id, sp.title
            FROM catalog_entries ce
            JOIN source_pages sp ON sp.id = ce.source_page_id
            WHERE ce.state = 'accepted' AND ce.analyzed_wikidata_id IS NOT NULL
            ORDER BY sp.provider, sp.language, sp.external_page_id
            """
        ).fetchall()
        groups: dict[str, CatalogGroup] = {}
        for row in rows:
            groups.setdefault(
                row["wikidata_id"],
                CatalogGroup(
                    row["wikidata_id"],
                    int(row["source_page_id"]),
                    int(row["source_revision_id"]),
                    row["title"],
                ),
            )
        selected = list(groups.values())
        return selected if limit is None else selected[:limit]

    def group_page(self, wikidata_id: str) -> WikipediaPage | None:
        """Read the Wikipedia revision analyzed by the catalog for this QID."""
        row = self.connection.execute(
            """
            SELECT sr.id AS source_revision_id, sr.external_revision_id,
                   sr.snapshot_path, sr.content_sha256, sp.language,
                   sp.external_page_id, sp.title
            FROM catalog_entries ce
            JOIN source_pages sp ON sp.id = ce.source_page_id
            JOIN source_revisions sr ON sr.id = ce.source_revision_id
            WHERE ce.state = 'accepted' AND ce.analyzed_wikidata_id = ?
            ORDER BY sp.provider, sp.language, sp.external_page_id
            LIMIT 1
            """,
            (wikidata_id,),
        ).fetchone()
        if row is None:
            return None
        content = self.repository.snapshots.read(row["snapshot_path"], row["content_sha256"])
        extract = json.loads(content).get("extract")
        return WikipediaPage(
            source_revision_id=int(row["source_revision_id"]),
            language=row["language"],
            page_id=int(row["external_page_id"]),
            revision_id=int(row["external_revision_id"]),
            extract=extract if isinstance(extract, str) else "",
            title=row["title"],
        )

    def save_entity_snapshot(
        self,
        run_id: int,
        document: EntityDocument,
        profile: str,
    ) -> int:
        content = canonical_json(document.payload)
        digest = hashlib.sha256(content).hexdigest()
        existing = self.connection.execute(
            """
            SELECT id, snapshot_path, content_sha256
            FROM wikidata_entity_snapshots
            WHERE wikidata_id=? AND external_revision_id=? AND request_profile=?
            """,
            (document.wikidata_id, document.revision_id, profile),
        ).fetchone()
        if existing is not None:
            if existing["content_sha256"] != digest:
                raise SnapshotIntegrityError(
                    f"Wikidata revision {document.revision_id} of "
                    f"{document.wikidata_id} changed content for profile {profile}"
                )
            self.repository.snapshots.verify(existing["snapshot_path"], digest)
            snapshot_id = int(existing["id"])
        else:
            snapshot_path, digest = self.repository.snapshots.write_entity(
                "wikidata",
                profile,
                document.wikidata_id,
                document.revision_id,
                content,
            )
            cursor = self.connection.execute(
                """
                INSERT INTO wikidata_entity_snapshots(
                    wikidata_id, external_revision_id, request_profile,
                    snapshot_path, content_sha256, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    document.wikidata_id,
                    document.revision_id,
                    profile,
                    snapshot_path,
                    digest,
                    utc_now(),
                ),
            )
            snapshot_id = int(cursor.lastrowid)
        self.connection.execute(
            """
            INSERT INTO fact_run_snapshots(fact_run_id, snapshot_id) VALUES (?, ?)
            ON CONFLICT(fact_run_id, snapshot_id) DO NOTHING
            """,
            (run_id, snapshot_id),
        )
        return snapshot_id

    def save_entity(
        self,
        document: EntityDocument,
        snapshot_id: int,
        profile: str,
        entity_type: str,
        source_page_id: int | None = None,
    ) -> tuple[int, str]:
        """Upsert one entity by QID and return its ID and stored type.

        Group and person types come from the subject role and replace a type
        inferred from a predicate. Other roles keep the first stored type. A
        label-only snapshot never replaces names taken from a subject snapshot.
        """
        now = utc_now()
        name = canonical_name(document.payload)
        existing = self.connection.execute(
            """
            SELECT e.id, e.entity_type, s.request_profile
            FROM entities e
            JOIN wikidata_entity_snapshots s ON s.id = e.snapshot_id
            WHERE e.wikidata_id=?
            """,
            (document.wikidata_id,),
        ).fetchone()
        if existing is None:
            cursor = self.connection.execute(
                """
                INSERT INTO entities(
                    wikidata_id, entity_type, canonical_name, snapshot_id,
                    source_page_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document.wikidata_id,
                    entity_type,
                    name,
                    snapshot_id,
                    source_page_id,
                    now,
                    now,
                ),
            )
            entity_id = int(cursor.lastrowid)
            stored_type = entity_type
            update_names = True
        else:
            entity_id = int(existing["id"])
            stored_type = (
                entity_type
                if entity_type in SUBJECT_ENTITY_TYPES
                else existing["entity_type"]
            )
            update_names = (
                profile == SUBJECT_PROFILE.name
                or existing["request_profile"] != SUBJECT_PROFILE.name
            )
            if update_names:
                self.connection.execute(
                    """
                    UPDATE entities
                    SET entity_type=?, canonical_name=?, snapshot_id=?,
                        source_page_id=COALESCE(?, source_page_id), updated_at=?
                    WHERE id=?
                    """,
                    (stored_type, name, snapshot_id, source_page_id, now, entity_id),
                )
            else:
                self.connection.execute(
                    """
                    UPDATE entities
                    SET entity_type=?, source_page_id=COALESCE(?, source_page_id)
                    WHERE id=?
                    """,
                    (stored_type, source_page_id, entity_id),
                )
        if update_names:
            self._replace_aliases(entity_id, snapshot_id, extract_aliases(document.payload))
        return entity_id, stored_type

    def _replace_aliases(
        self,
        entity_id: int,
        snapshot_id: int,
        aliases: Iterable[Alias],
    ) -> None:
        self.connection.execute("DELETE FROM entity_aliases WHERE entity_id=?", (entity_id,))
        self.connection.executemany(
            """
            INSERT INTO entity_aliases(
                entity_id, name, language, alias_type, source_property, snapshot_id
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    entity_id,
                    alias.name,
                    alias.language,
                    alias.alias_type,
                    alias.source_property,
                    snapshot_id,
                )
                for alias in aliases
            ],
        )

    def record_issue(self, run_id: int, wikidata_id: str, code: str, detail: str) -> None:
        self.connection.execute(
            """
            INSERT INTO fact_issues(fact_run_id, wikidata_id, issue_code, detail)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(fact_run_id, wikidata_id, issue_code, detail) DO NOTHING
            """,
            (run_id, wikidata_id, code, detail),
        )

    def save_facts(
        self,
        run_id: int,
        extractor_version: str,
        subject_entity_id: int,
        snapshot_id: int,
        decisions: Iterable[FactDecision],
        entity_ids: Mapping[str, int],
    ) -> None:
        """Upsert the subject's facts by statement ID and remove stale statements."""
        now = utc_now()
        current: list[str] = []
        for decision in decisions:
            candidate = decision.candidate
            statement = candidate.statement
            current.append(statement.statement_id)
            time = candidate.time
            fact_id = self.connection.execute(
                """
                INSERT INTO facts(
                    subject_entity_id, predicate, property_id, statement_id, rank,
                    value_wikidata_id, value_entity_id, value_time, value_precision,
                    value_calendar, value_raw_json, valid_from, valid_from_precision,
                    valid_to, valid_to_precision, qualifiers_json, references_json,
                    status, status_reason, quality_flags_json, snapshot_id,
                    fact_run_id, extractor_version, extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(statement_id) DO UPDATE SET
                    subject_entity_id=excluded.subject_entity_id,
                    predicate=excluded.predicate,
                    property_id=excluded.property_id,
                    rank=excluded.rank,
                    value_wikidata_id=excluded.value_wikidata_id,
                    value_entity_id=excluded.value_entity_id,
                    value_time=excluded.value_time,
                    value_precision=excluded.value_precision,
                    value_calendar=excluded.value_calendar,
                    value_raw_json=excluded.value_raw_json,
                    valid_from=excluded.valid_from,
                    valid_from_precision=excluded.valid_from_precision,
                    valid_to=excluded.valid_to,
                    valid_to_precision=excluded.valid_to_precision,
                    qualifiers_json=excluded.qualifiers_json,
                    references_json=excluded.references_json,
                    status=excluded.status,
                    status_reason=excluded.status_reason,
                    quality_flags_json=excluded.quality_flags_json,
                    snapshot_id=excluded.snapshot_id,
                    fact_run_id=excluded.fact_run_id,
                    extractor_version=excluded.extractor_version,
                    extracted_at=excluded.extracted_at
                RETURNING id
                """,
                (
                    subject_entity_id,
                    candidate.predicate,
                    statement.property_id,
                    statement.statement_id,
                    statement.rank,
                    candidate.value_id,
                    entity_ids.get(candidate.value_id) if candidate.value_id else None,
                    time.value if time else None,
                    time.precision if time else None,
                    time.calendar if time else None,
                    _json(statement.raw_value),
                    candidate.valid_from.value if candidate.valid_from else None,
                    candidate.valid_from.precision if candidate.valid_from else None,
                    candidate.valid_to.value if candidate.valid_to else None,
                    candidate.valid_to.precision if candidate.valid_to else None,
                    _json(statement.qualifiers),
                    _json(
                        [
                            {
                                "hash": reference.hash,
                                "properties": list(reference.properties),
                                "sources": {
                                    key: classify_source(key) for key in reference.source_keys
                                },
                            }
                            for reference in statement.references
                        ]
                    ),
                    decision.status,
                    decision.reason,
                    _json(list(decision.flags)),
                    snapshot_id,
                    run_id,
                    extractor_version,
                    now,
                ),
            ).fetchone()["id"]
            self.connection.execute("DELETE FROM fact_evidence WHERE fact_id=?", (fact_id,))
            for item in decision.evidence:
                wikidata = item.evidence_type == "wikidata_reference"
                self.connection.execute(
                    """
                    INSERT INTO fact_evidence(
                        fact_id, evidence_type, wikidata_snapshot_id, reference_hash,
                        source_revision_id, source_key, locator, snippet
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(fact_id, evidence_type, locator) DO NOTHING
                    """,
                    (
                        fact_id,
                        item.evidence_type,
                        snapshot_id if wikidata else None,
                        item.reference_hash,
                        item.source_revision_id,
                        item.source_key,
                        item.locator,
                        item.snippet,
                    ),
                )
        self._delete_removed_statements(subject_entity_id, current)
        self.connection.execute(
            "UPDATE entities SET last_fact_run_id=? WHERE id=?", (run_id, subject_entity_id)
        )

    def _delete_removed_statements(self, subject_entity_id: int, current: Iterable[str]) -> None:
        keep = set(current)
        removed = [
            int(row["id"])
            for row in self.connection.execute(
                "SELECT id, statement_id FROM facts WHERE subject_entity_id=?",
                (subject_entity_id,),
            )
            if row["statement_id"] not in keep
        ]
        for fact_id in removed:
            self.connection.execute("DELETE FROM fact_evidence WHERE fact_id=?", (fact_id,))
            self.connection.execute("DELETE FROM facts WHERE id=?", (fact_id,))

    def mark_stale_facts(self, run_id: int) -> int:
        """Mark facts whose subject left the catalog or every group member list.

        Groups need an accepted catalog entry for their source page. The source
        page remains stable when a Wikidata QID redirects. People need a current
        ``has_member`` fact from some group. Processing the subject again replaces
        the stale status with a new decision.
        """
        cursor = self.connection.execute(
            """
            UPDATE facts
            SET status=?, status_reason='subject_not_in_catalog', fact_run_id=?
            WHERE status != ?
              AND subject_entity_id IN (
                SELECT e.id FROM entities e
                WHERE e.entity_type = 'group'
                  AND NOT EXISTS (
                    SELECT 1 FROM catalog_entries ce
                    WHERE ce.state = 'accepted' AND ce.source_page_id = e.source_page_id
                  )
              )
            """,
            (STALE, run_id, STALE),
        )
        stale = cursor.rowcount
        cursor = self.connection.execute(
            """
            UPDATE facts
            SET status=?, status_reason='subject_not_listed_by_group', fact_run_id=?
            WHERE status != ?
              AND subject_entity_id IN (
                SELECT e.id FROM entities e
                WHERE e.entity_type = 'person'
                  AND NOT EXISTS (
                    SELECT 1 FROM facts member
                    WHERE member.predicate = 'has_member'
                      AND member.value_entity_id = e.id
                      AND member.status != ?
                  )
              )
            """,
            (STALE, run_id, STALE, STALE),
        )
        return stale + cursor.rowcount

    def mark_catalog_subjects_stale(
        self,
        run_id: int,
        source_page_ids: Iterable[int],
    ) -> int:
        """Retire facts for selected catalog groups unavailable in this run."""
        page_ids = sorted(set(source_page_ids))
        if not page_ids:
            return 0
        placeholders = ",".join("?" for _ in page_ids)
        cursor = self.connection.execute(
            f"""
            UPDATE facts
            SET status=?, status_reason='subject_unavailable', fact_run_id=?
            WHERE status != ?
              AND subject_entity_id IN (
                SELECT id FROM entities
                WHERE source_page_id IN ({placeholders})
              )
            """,
            (STALE, run_id, STALE, *page_ids),
        )
        return cursor.rowcount

    def accepted_facts_without_evidence(self) -> int:
        return int(
            self.connection.execute(
                """
                SELECT COUNT(*) FROM facts f
                WHERE f.status = ?
                  AND NOT EXISTS (SELECT 1 FROM fact_evidence e WHERE e.fact_id = f.id)
                """,
                (ACCEPTED,),
            ).fetchone()[0]
        )


def count_statuses(decisions: Iterable[FactDecision]) -> dict[str, int]:
    totals = {ACCEPTED: 0, REJECTED: 0, CONFLICT: 0, SUPERSEDED: 0}
    for decision in decisions:
        totals[decision.status] += 1
    return totals


def _json(value: object) -> str:
    return canonical_json(value).decode("utf-8")
