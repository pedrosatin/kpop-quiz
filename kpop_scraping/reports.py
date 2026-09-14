"""CSV coverage report for facts of accepted catalog groups."""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

from .facts import GROUP_PREDICATES, PERSON_PREDICATES
from .release_facts import RELEASE_PREDICATES
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
        WITH linked_groups AS (
            SELECT e.id, e.wikidata_id, e.canonical_name,
                   sp.external_page_id, sp.title, sp.provider, sp.language,
                   ROW_NUMBER() OVER (
                       PARTITION BY e.id
                       ORDER BY sp.provider, sp.language, sp.external_page_id
                   ) AS position
            FROM catalog_entity_links cel
            JOIN catalog_entries ce ON ce.source_page_id = cel.source_page_id
            JOIN entities e ON e.id = cel.entity_id
            JOIN source_pages sp ON sp.id = cel.source_page_id
            WHERE e.entity_type = 'group' AND ce.state = 'accepted'
              AND e.last_fact_run_id IS NOT NULL
        )
        SELECT id, wikidata_id, canonical_name, external_page_id, title
        FROM linked_groups
        WHERE position = 1
        ORDER BY provider, language, external_page_id
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


def export_release_coverage_csv(connection: sqlite3.Connection, output_path: Path) -> int:
    """Write release discovery and fact coverage by catalog group."""
    fields = ("group_wikidata_id", "group_name", "candidates", "candidate_accepted", "candidate_rejected", "release_entities", "predicate", *STATUSES)
    groups = connection.execute(
        """SELECT DISTINCT g.id,g.wikidata_id,g.canonical_name FROM release_candidates rc
        JOIN entities g ON g.id=rc.group_entity_id ORDER BY g.wikidata_id"""
    ).fetchall()
    output_rows = []
    for group in groups:
        candidate_counts = {row["state"]: int(row["total"]) for row in connection.execute(
            "SELECT state,COUNT(*) total FROM release_candidates WHERE group_entity_id=? GROUP BY state", (group["id"],)
        )}
        release_ids = [int(row[0]) for row in connection.execute(
            "SELECT DISTINCT entity_id FROM release_candidates WHERE group_entity_id=? AND state='accepted' AND entity_id IS NOT NULL", (group["id"],)
        )]
        for spec in RELEASE_PREDICATES:
            statuses = {status: 0 for status in STATUSES}
            if release_ids:
                placeholders = ",".join("?" for _ in release_ids)
                for row in connection.execute(
                    f"SELECT status,COUNT(*) total FROM facts WHERE subject_entity_id IN ({placeholders}) AND predicate=? GROUP BY status", (*release_ids, spec.predicate)
                ):
                    statuses[row["status"]] = int(row["total"])
            output_rows.append({"group_wikidata_id": group["wikidata_id"], "group_name": group["canonical_name"], "candidates": sum(candidate_counts.values()), "candidate_accepted": candidate_counts.get("accepted", 0), "candidate_rejected": candidate_counts.get("rejected", 0), "release_entities": len(release_ids), "predicate": spec.predicate, **statuses})
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: spreadsheet_safe(value) for key, value in row.items()} for row in output_rows)
    return len(output_rows)


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
