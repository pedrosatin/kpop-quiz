"""Select closed, explicitly current revision rosters for grid counts.

Accepted membership facts also describe former members. Their absence of an
end qualifier is not evidence of a current roster.
"""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from dataclasses import replace
from datetime import date

from .quiz_models import Entity, Fact

# Only complete present-tense enumerations with an explicit total are supported.
# An unsupported construction remains unknown, rather than a smaller roster.
_ROSTER = re.compile(
    r"The (?:group|band) (?:currently )?(?:consists of|is (?:currently )?composed of|has) "
    r"(?P<count>\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen) "
    r"members: (?P<names>.+)\.", re.I,
)
_NUMBERS = dict(zip(
    ("two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"),
    range(2, 14),
))


def _roster(snippet: str, identities: dict[str, set[str]]) -> frozenset[str] | None:
    match = _ROSTER.fullmatch(snippet)
    if match is None:
        return None
    count_text = match["count"].lower()
    count = int(count_text) if count_text.isdecimal() else _NUMBERS[count_text]
    names = re.split(r",\s*(?:and\s+)?|\s+and\s+", match["names"])
    members = []
    for name in names:
        ids = identities.get(name.strip().casefold(), set())
        if len(ids) != 1:
            return None
        members.append(next(iter(ids)))
    if len(members) != count or len(set(members)) != count:
        return None
    return frozenset(members)


def _former_member(snippet: str, person: Entity | None) -> bool:
    if person is None:
        return False
    if re.match(r"^past_members\s*=", snippet, re.I):
        return True
    if re.search(r"\b(?:rejoined|returned)\b", snippet, re.I):
        return False
    return any(
        re.search(
            rf"(?<![\w-]){re.escape(name)},?\s+(?:departed|left) the group\b",
            snippet, re.I,
        )
        for name in person.identity_names()
    )


def _period_allows(fact: Fact, reference_date: date) -> bool:
    # Qualifiers may veto a contradictory roster, but never prove membership.
    # Compare at their recorded precision, without inventing a month or day.
    value = reference_date.isoformat()
    return not (
        fact.valid_from and fact.valid_from > value[:len(fact.valid_from)]
        or fact.valid_to and fact.valid_to < value[:len(fact.valid_to)]
    )


def grid_member_facts(
    connection: sqlite3.Connection,
    facts: list[Fact],
    entities: dict[int, Entity],
    reference_date: date,
) -> list[Fact]:
    """Require every name of a closed current list to have accepted evidence.

    Proof is bounded to the cited revision, not lifetime membership. Multiple
    closed lists must agree. Rejected/conflicting/unresolved members cannot be
    omitted to obtain a smaller count. Historical facts remain in the database.
    """
    identities: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in connection.execute(
        "SELECT subject_entity_id, value_entity_id FROM facts "
        "WHERE predicate='has_member' AND status NOT IN ('stale', 'superseded')"
    ):
        subject = entities.get(row["subject_entity_id"])
        person = entities.get(row["value_entity_id"])
        if subject and person and person.entity_type == "person":
            for name in person.identity_names():
                identities[subject.wikidata_id][name.strip().casefold()].add(person.wikidata_id)
    assertions: dict[str, dict[str, str | None]] = defaultdict(dict)
    for row in connection.execute("""
        SELECT e.wikidata_id, f.statement_id, f.value_wikidata_id, v.wikidata_id AS value_id
        FROM facts f JOIN entities e ON e.id=f.subject_entity_id
        LEFT JOIN entities v ON v.id=f.value_entity_id
        WHERE f.predicate='has_member' AND f.status NOT IN ('stale', 'superseded')
    """):
        assertions[row["wikidata_id"]][row["statement_id"]] = row["value_id"] or row["value_wikidata_id"]
    historical: set[str] = set()
    loaded = {f.statement_id: f for f in facts if f.predicate == "has_member"}
    proofs: dict[str, dict[tuple[int, str], list[tuple[str, str]]]] = defaultdict(lambda: defaultdict(list))
    rows = connection.execute("""
        SELECT e.wikidata_id, f.statement_id, fe.source_revision_id, fe.snippet, fe.locator, f.value_entity_id
        FROM facts f JOIN entities e ON e.id=f.subject_entity_id
        JOIN fact_evidence fe ON fe.fact_id=f.id
        WHERE f.predicate='has_member' AND f.status NOT IN ('stale', 'superseded')
          AND fe.evidence_type='wikipedia_revision'
        ORDER BY e.wikidata_id, fe.source_revision_id, fe.snippet, fe.locator, f.statement_id
    """)
    for row in rows:
        snippet = row["snippet"] or ""
        if _former_member(snippet, entities.get(row["value_entity_id"])):
            historical.add(row["statement_id"])
        if _ROSTER.fullmatch(snippet):
            proofs[row["wikidata_id"]][(row["source_revision_id"], snippet)].append((row["statement_id"], row["locator"]))
    selected = []
    for group, lists in proofs.items():
        rosters = [_roster(snippet, identities[group]) for _, snippet in lists]
        if None in rosters or len(set(rosters)) != 1:
            continue
        expected = rosters[0]
        if any(
            person not in expected and statement not in historical
            for statement, person in assertions[group].items()
        ):
            continue
        for statements in lists.values():
            locators: dict[str, set[str]] = defaultdict(set)
            for statement_id, locator in statements:
                locators[statement_id].add(locator)
            members = [
                replace(loaded[s], evidence=tuple(
                    e for e in loaded[s].evidence if e.locator in locators[s]
                ))
                for s in locators if s in loaded
            ]
            actual = {f.value_entity.wikidata_id for f in members if f.value_entity}
            if actual != expected or any(
                not f.evidence or not _period_allows(f, reference_date) for f in members
            ):
                break
        else:
            # Use one complete revision list; do not mix evidence across lists.
            selected.extend(members)
    return selected
