"""CSV coverage report for facts of accepted catalog groups."""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

from .facts import GROUP_PREDICATES, PERSON_PREDICATES
from .storage import spreadsheet_safe


COVERAGE_FIELDS = (
    "group_wikidata_id",
    "group_name",
    "pageid",
    "page_title",
    "scope",
    "predicate",
    "subjects",
    "facts",
    "accepted",
    "rejected",
    "conflict",
    "superseded",
    "stale",
    "subjects_with_accepted",
    "coverage",
)
STATUSES = ("accepted", "rejected", "conflict", "superseded", "stale")

Counts = dict[tuple[int, str], dict[str, int]]


def export_fact_coverage_csv(connection: sqlite3.Connection, output_path: Path) -> int:
    """Write one row per processed group and predicate.

    Group rows count the group's own facts. Member rows add the facts of every
    person linked to the group by ``has_member`` or ``member_of``; for
    ``member_of`` only links to that group are counted.
    """
    groups = connection.execute(
        """
        SELECT e.id, e.wikidata_id, e.canonical_name, sp.external_page_id, sp.title
        FROM entities e
        JOIN catalog_entries ce ON ce.source_page_id = e.source_page_id
        JOIN source_pages sp ON sp.id = e.source_page_id
        WHERE e.entity_type = 'group' AND ce.state = 'accepted'
          AND ce.analyzed_wikidata_id = e.wikidata_id
          AND e.last_fact_run_id IS NOT NULL
        ORDER BY sp.provider, sp.language, sp.external_page_id
        """
    ).fetchall()
    counts: Counts = {}
    for row in connection.execute(
        """
        SELECT subject_entity_id, predicate, status, COUNT(*) AS total
        FROM facts WHERE predicate != 'member_of'
        GROUP BY subject_entity_id, predicate, status
        """
    ):
        _add(counts, (row["subject_entity_id"], row["predicate"]), row["status"], row["total"])
    member_of: dict[int, Counts] = {}
    for row in connection.execute(
        """
        SELECT subject_entity_id, value_entity_id, status, COUNT(*) AS total
        FROM facts WHERE predicate = 'member_of' AND value_entity_id IS NOT NULL
        GROUP BY subject_entity_id, value_entity_id, status
        """
    ):
        group_counts = member_of.setdefault(row["value_entity_id"], {})
        _add(group_counts, (row["subject_entity_id"], "member_of"), row["status"], row["total"])
    members: dict[int, set[int]] = {}
    for row in connection.execute(
        """
        SELECT f.subject_entity_id AS group_id, f.value_entity_id AS person_id
        FROM facts f JOIN entities e ON e.id = f.value_entity_id
        WHERE f.predicate = 'has_member' AND e.entity_type = 'person'
        UNION
        SELECT f.value_entity_id, f.subject_entity_id
        FROM facts f JOIN entities e ON e.id = f.subject_entity_id
        WHERE f.predicate = 'member_of' AND e.entity_type = 'person'
          AND f.value_entity_id IS NOT NULL
        """
    ):
        members.setdefault(row["group_id"], set()).add(row["person_id"])

    rows = []
    for group in groups:
        base = {
            "group_wikidata_id": group["wikidata_id"],
            "group_name": group["canonical_name"],
            "pageid": group["external_page_id"],
            "page_title": group["title"],
        }
        for spec in GROUP_PREDICATES:
            rows.append({**base, **_row("group", spec.predicate, [group["id"]], counts)})
        people = sorted(members.get(group["id"], ()))
        group_member_of = member_of.get(group["id"], {})
        for spec in PERSON_PREDICATES:
            source = group_member_of if spec.predicate == "member_of" else counts
            rows.append({**base, **_row("member", spec.predicate, people, source)})

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=COVERAGE_FIELDS)
        writer.writeheader()
        writer.writerows(
            {key: spreadsheet_safe(value) for key, value in row.items()} for row in rows
        )
    return len(rows)


def _add(counts: Counts, key: tuple[int, str], status: str, total: int) -> None:
    counts.setdefault((int(key[0]), key[1]), {})[status] = int(total)


def _row(scope: str, predicate: str, subjects: list[int], counts: Counts) -> dict[str, object]:
    totals = {status: 0 for status in STATUSES}
    with_accepted = 0
    for subject in subjects:
        by_status = counts.get((subject, predicate), {})
        for status in STATUSES:
            totals[status] += by_status.get(status, 0)
        with_accepted += int(by_status.get("accepted", 0) > 0)
    facts = sum(totals.values())
    if facts == 0:
        coverage = "missing"
    elif totals["accepted"] == 0:
        coverage = "no_accepted"
    elif with_accepted < len(subjects):
        coverage = "partial"
    else:
        coverage = "covered"
    return {
        "scope": scope,
        "predicate": predicate,
        "subjects": len(subjects),
        "facts": facts,
        **totals,
        "subjects_with_accepted": with_accepted,
        "coverage": coverage,
    }
