"""Read-only coverage summary for map-game geography candidates."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any


def build_geo_coverage_report(connection: sqlite3.Connection) -> dict[str, Any]:
    """Summarize accepted catalog coverage without resolving places to countries.

    The report distinguishes group-origin facts from member birthplaces. A
    birthplace is counted as a place candidate only; it is not treated as a
    country unless a later, explicit geographic hierarchy resolves it.
    """
    groups = connection.execute(
        """
        WITH linked_groups AS (
            SELECT e.id, e.wikidata_id, e.canonical_name, e.last_fact_run_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY e.id
                       ORDER BY sp.provider, sp.language, sp.external_page_id
                   ) AS position
            FROM catalog_entity_links cel
            JOIN catalog_entries ce ON ce.source_page_id = cel.source_page_id
            JOIN entities e ON e.id = cel.entity_id
            JOIN source_pages sp ON sp.id = cel.source_page_id
            WHERE e.entity_type = 'group' AND ce.state = 'accepted'
        )
        SELECT id, wikidata_id, canonical_name, last_fact_run_id
        FROM linked_groups WHERE position = 1
        ORDER BY wikidata_id
        """
    ).fetchall()
    processed_group_ids = {int(row["id"]) for row in groups if row["last_fact_run_id"] is not None}
    origin_facts = _fact_rows(connection, processed_group_ids, "origin_country")

    member_ids = _member_ids(connection, processed_group_ids)
    birthplace_facts = _fact_rows(connection, member_ids, "born_in")

    return {
        "report_version": "geo-coverage-v1",
        "scope": {
            "accepted_catalog_groups": len(groups),
            "groups_with_fact_run": len(processed_group_ids),
            "unique_members_of_processed_groups": len(member_ids),
        },
        "origin_country": _summarize(
            origin_facts,
            eligible_subjects=len(processed_group_ids),
            value_label="country_candidate",
        ),
        "born_in": _summarize(
            birthplace_facts,
            eligible_subjects=len(member_ids),
            value_label="place_candidate",
            geographic_resolution="not_performed",
        ),
    }


def _member_ids(connection: sqlite3.Connection, group_ids: set[int]) -> set[int]:
    if not group_ids:
        return set()
    members: set[int] = set()
    for group_chunk in _chunks(sorted(group_ids), 400):
        placeholders = ",".join("?" for _ in group_chunk)
        rows = connection.execute(
            f"""
            SELECT f.value_entity_id AS person_id
            FROM facts f JOIN entities e ON e.id = f.value_entity_id
            WHERE f.subject_entity_id IN ({placeholders})
              AND f.predicate = 'has_member' AND f.status = 'accepted'
              AND e.entity_type = 'person'
            UNION
            SELECT f.subject_entity_id
            FROM facts f JOIN entities e ON e.id = f.subject_entity_id
            WHERE f.value_entity_id IN ({placeholders})
              AND f.predicate = 'member_of' AND f.status = 'accepted'
              AND e.entity_type = 'person'
            """,
            (*group_chunk, *group_chunk),
        ).fetchall()
        members.update(int(row["person_id"]) for row in rows)
    return members


def _fact_rows(
    connection: sqlite3.Connection, subject_ids: set[int], predicate: str
) -> list[sqlite3.Row]:
    if not subject_ids:
        return []
    rows = []
    for subject_chunk in _chunks(sorted(subject_ids), 900):
        placeholders = ",".join("?" for _ in subject_chunk)
        rows.extend(
            connection.execute(
                f"""
                SELECT f.subject_entity_id, f.status, f.value_wikidata_id,
                       value.canonical_name AS value_name
                FROM facts f
                LEFT JOIN entities value ON value.id = f.value_entity_id
                WHERE f.subject_entity_id IN ({placeholders}) AND f.predicate = ?
                ORDER BY f.value_wikidata_id, f.status
                """,
                (*subject_chunk, predicate),
            ).fetchall()
        )
    return rows


def _chunks(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _summarize(
    rows: list[sqlite3.Row],
    *,
    eligible_subjects: int,
    value_label: str,
    geographic_resolution: str | None = None,
) -> dict[str, Any]:
    statuses = Counter(str(row["status"]) for row in rows)
    accepted_values: Counter[tuple[str, str]] = Counter(
        (
            str(row["value_wikidata_id"]),
            str(row["value_name"] or row["value_wikidata_id"]),
        )
        for row in rows
        if row["status"] == "accepted" and row["value_wikidata_id"]
    )
    accepted_subjects = {
        int(row["subject_entity_id"])
        for row in rows
        if row["status"] == "accepted" and row["value_wikidata_id"]
    }
    distinct_values = {qid for qid, _name in accepted_values}
    result: dict[str, Any] = {
        "eligible_subjects": eligible_subjects,
        "subjects_with_accepted_fact": len(accepted_subjects),
        "subject_coverage": (
            len(accepted_subjects) / eligible_subjects if eligible_subjects else 0
        ),
        "accepted_facts": statuses.get("accepted", 0),
        "facts_by_status": {
            status: statuses.get(status, 0)
            for status in ("accepted", "rejected", "conflict", "superseded", "stale")
        },
        "distinct_accepted_values": len(distinct_values),
        "accepted_value_distribution": [
            {"wikidata_id": qid, "name": name, "facts": count}
            for (qid, name), count in sorted(accepted_values.items())
        ],
        "value_kind": value_label,
    }
    if geographic_resolution is not None:
        result["geographic_resolution"] = geographic_resolution
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Write a read-only geography coverage report from an existing SQLite database"
    )
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.database.is_file():
        raise SystemExit(f"database does not exist: {args.database}")
    connection = sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    try:
        report = build_geo_coverage_report(connection)
    except (sqlite3.Error, ValueError) as exc:
        raise SystemExit(f"geography coverage failed: {type(exc).__name__}: {exc}") from exc
    finally:
        connection.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Geography coverage: {report['scope']['groups_with_fact_run']} groups, "
        f"{report['origin_country']['distinct_accepted_values']} accepted origin-country candidates; "
        f"{report['born_in']['distinct_accepted_values']} accepted birthplace candidates"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
