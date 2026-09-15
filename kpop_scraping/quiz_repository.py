"""Read quiz inputs and derive their deterministic dataset version."""

from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import date

from .quiz_models import Entity, Evidence, Fact, GENERATOR_VERSION
from .quiz_schema import DATASET_SCHEMA_VERSION
from .quiz_templates import TEMPLATE_VERSION, TEMPLATES
from .quiz_utils import hash_payload
from .sources import SOURCE_POLICY_VERSION


def _load_entities(connection: sqlite3.Connection) -> dict[int, Entity]:
    rows = connection.execute(
        "SELECT id, wikidata_id, entity_type, canonical_name FROM entities ORDER BY wikidata_id"
    ).fetchall()
    names: dict[int, dict[str, str]] = defaultdict(dict)
    for row in connection.execute(
        """
        SELECT entity_id, language, name FROM entity_aliases
        WHERE alias_type='label' AND language IN ('pt', 'en')
        ORDER BY entity_id, language, name
        """
    ):
        names[int(row["entity_id"])].setdefault(row["language"], row["name"])
    return {
        int(row["id"]): Entity(
            row["wikidata_id"],
            row["entity_type"],
            row["canonical_name"],
            names.get(int(row["id"]), {}),
        )
        for row in rows
    }


def _load_facts(
    connection: sqlite3.Connection,
    entities: dict[int, Entity],
) -> tuple[list[Fact], Counter[str]]:
    evidence = _load_evidence(connection)
    rejected: Counter[str] = Counter()
    supported = {
        "formed_on", "born_on", "has_member", "member_of", "record_label",
        "performed_by", "released_on",
    }
    rows = connection.execute(
        """
        SELECT id, statement_id, subject_entity_id, predicate, value_entity_id,
               value_time, value_precision, valid_from, valid_from_precision,
               valid_to, valid_to_precision, quality_flags_json, status, status_reason
        FROM facts ORDER BY statement_id
        """
    ).fetchall()
    conflicts = [row for row in rows if row["status"] == "conflict"]
    accepted: list[Fact] = []
    for row in rows:
        if row["status"] != "accepted":
            reason = row["status_reason"] or "no_reason"
            rejected[f"fact_{row['status']}__{reason}"] += 1
            continue
        if row["predicate"] not in supported:
            rejected["unsupported_predicate"] += 1
            continue
        if _has_open_conflict(row, conflicts):
            rejected["open_conflict"] += 1
            continue
        fact_evidence = evidence.get(int(row["id"]), ())
        if not fact_evidence:
            rejected["missing_evidence"] += 1
            continue
        subject = entities.get(int(row["subject_entity_id"]))
        value_id = row["value_entity_id"]
        value_entity = entities.get(int(value_id)) if value_id is not None else None
        if subject is None or value_id is not None and value_entity is None:
            rejected["missing_entity"] += 1
            continue
        accepted.append(
            Fact(
                row["statement_id"],
                subject,
                row["predicate"],
                value_entity,
                row["value_time"],
                row["value_precision"],
                row["valid_from"],
                row["valid_from_precision"],
                row["valid_to"],
                row["valid_to_precision"],
                tuple(json.loads(row["quality_flags_json"])),
                fact_evidence,
            )
        )
    return accepted, rejected


def _load_evidence(connection: sqlite3.Connection) -> dict[int, tuple[Evidence, ...]]:
    result: dict[int, list[Evidence]] = defaultdict(list)
    rows = connection.execute(
        """
        SELECT fe.fact_id, f.statement_id, fe.source_key, fe.locator, fe.evidence_type,
               ws.wikidata_id, ws.external_revision_id AS wikidata_revision,
               sp.language, sp.external_page_id,
               sr.external_revision_id AS wikipedia_revision
        FROM fact_evidence fe
        JOIN facts f ON f.id=fe.fact_id
        LEFT JOIN wikidata_entity_snapshots ws ON ws.id=fe.wikidata_snapshot_id
        LEFT JOIN source_revisions sr ON sr.id=fe.source_revision_id
        LEFT JOIN source_pages sp ON sp.id=sr.source_page_id
        ORDER BY fe.fact_id, fe.evidence_type, fe.locator, fe.source_key
        """
    )
    for row in rows:
        if row["evidence_type"] == "wikipedia_revision":
            revision = int(row["wikipedia_revision"])
            url = (
                f"https://{row['language']}.wikipedia.org/w/index.php?"
                f"curid={row['external_page_id']}&oldid={revision}"
            )
        else:
            revision = int(row["wikidata_revision"])
            url = (
                "https://www.wikidata.org/w/index.php?title="
                f"Special:EntityPage/{row['wikidata_id']}&oldid={revision}"
            )
        result[int(row["fact_id"])].append(
            Evidence(
                row["statement_id"], row["source_key"], row["locator"], url, revision
            )
        )
    return {key: tuple(values) for key, values in result.items()}


def _has_open_conflict(row: sqlite3.Row, conflicts: list[sqlite3.Row]) -> bool:
    for conflict in conflicts:
        if (
            conflict["subject_entity_id"] != row["subject_entity_id"]
            or conflict["predicate"] != row["predicate"]
        ):
            continue
        if row["predicate"] in {
            "has_member", "member_of", "record_label", "performed_by"
        }:
            if conflict["value_entity_id"] == row["value_entity_id"]:
                return True
        else:
            return True
    return False


def _dataset_version(
    connection: sqlite3.Connection,
    entities: dict[int, Entity],
    reference_date: date,
) -> str:
    fact_rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT f.statement_id, subject.wikidata_id AS subject_wikidata_id,
                   f.predicate, f.property_id, f.rank,
                   COALESCE(value.wikidata_id, f.value_wikidata_id) AS value_wikidata_id,
                   value_time, value_precision, valid_from, valid_from_precision,
                   valid_to, valid_to_precision, qualifiers_json, references_json,
                   status, status_reason, quality_flags_json, extractor_version
            FROM facts f
            JOIN entities subject ON subject.id=f.subject_entity_id
            LEFT JOIN entities value ON value.id=f.value_entity_id
            ORDER BY f.statement_id
            """
        )
    ]
    evidence_rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT f.statement_id, fe.evidence_type, fe.source_key, fe.locator,
                   fe.reference_hash, fe.snippet,
                   ws.wikidata_id, ws.external_revision_id AS wikidata_revision,
                   sp.provider, sp.language, sp.external_page_id,
                   sr.external_revision_id AS source_revision
            FROM fact_evidence fe JOIN facts f ON f.id=fe.fact_id
            LEFT JOIN wikidata_entity_snapshots ws ON ws.id=fe.wikidata_snapshot_id
            LEFT JOIN source_revisions sr ON sr.id=fe.source_revision_id
            LEFT JOIN source_pages sp ON sp.id=sr.source_page_id
            ORDER BY f.statement_id, fe.evidence_type, fe.locator, fe.source_key
            """
        )
    ]
    entity_rows = [
        {
            "canonical_name": entity.canonical_name,
            "entity_type": entity.entity_type,
            "names": entity.names,
            "wikidata_id": entity.wikidata_id,
        }
        for entity in sorted(entities.values(), key=lambda item: item.wikidata_id)
    ]
    return hash_payload(
        {
            "entities": entity_rows,
            "evidence": evidence_rows,
            "facts": fact_rows,
            "generator_version": GENERATOR_VERSION,
            "reference_date": reference_date.isoformat(),
            "schema_version": DATASET_SCHEMA_VERSION,
            "source_policy_version": SOURCE_POLICY_VERSION,
            "template_version": TEMPLATE_VERSION,
            "templates": TEMPLATES,
        }
    )
