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
# The enumeration may end with one clause naming who left, as in "..., while
# former member Wonho left the group in October 2019."; the clause adds no
# member and cannot name anyone on the roster.
_ROSTER = re.compile(
    r"The (?:group|band) (?:currently )?(?:consists of|is (?:currently )?composed of|has) "
    r"(?P<count>\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen) "
    r"members: (?P<names>.+?)"
    r"(?:, while former members? (?P<former>[^.,]+?) (?:left|departed) the group"
    r"(?: in (?:[A-Z][a-z]+ )?\d{4})?)?\.", re.I,
)
# A revision is identified by what the source says (key, page id, revision id),
# never by a local row id, so equivalent databases select the same proof.
Revision = tuple[str, int, int]
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
    if match["former"] and {
        name.strip().casefold() for name in re.split(r",\s*(?:and\s+)?|\s+and\s+", match["former"])
    } & {name.strip().casefold() for name in names}:
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
    omitted to obtain a smaller count. Former-member proof excludes a person
    only within the cited revisions, and a positive current claim for that
    person blocks the count. Of several agreeing lists, the newest revision
    supplies the evidence. Historical facts remain in the database.
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
    loaded = {f.statement_id: f for f in facts if f.predicate == "has_member"}
    historical: dict[str, set[Revision]] = defaultdict(set)
    current_claims: dict[str, set[Revision]] = defaultdict(set)
    proofs: dict[str, dict[tuple[Revision, str], list[tuple[str, str]]]] = defaultdict(lambda: defaultdict(list))
    rows = connection.execute("""
        SELECT e.wikidata_id, f.statement_id, fe.source_key, sp.external_page_id,
               sr.external_revision_id, fe.snippet, fe.locator, f.value_entity_id
        FROM facts f JOIN entities e ON e.id=f.subject_entity_id
        JOIN fact_evidence fe ON fe.fact_id=f.id
        JOIN source_revisions sr ON sr.id=fe.source_revision_id
        JOIN source_pages sp ON sp.id=sr.source_page_id
        WHERE f.predicate='has_member' AND f.status NOT IN ('stale', 'superseded')
          AND fe.evidence_type='wikipedia_revision'
        ORDER BY e.wikidata_id, f.statement_id, fe.source_key, sp.external_page_id,
                 sr.external_revision_id, fe.snippet, fe.locator
    """)
    for row in rows:
        snippet = row["snippet"] or ""
        revision: Revision = (
            row["source_key"], int(row["external_page_id"]), int(row["external_revision_id"])
        )
        if _former_member(snippet, entities.get(row["value_entity_id"])):
            historical[row["statement_id"]].add(revision)
        if re.match(r"^current_members\s*=", snippet, re.I):
            current_claims[row["statement_id"]].add(revision)
        if _ROSTER.fullmatch(snippet):
            proofs[row["wikidata_id"]][(revision, snippet)].append((row["statement_id"], row["locator"]))
    selected = []
    for group, lists in proofs.items():
        rosters = [_roster(snippet, identities[group]) for _, snippet in lists]
        if None in rosters or len(set(rosters)) != 1:
            continue
        expected = rosters[0]
        revisions = {revision for revision, _ in lists}
        # Former-member proof is bounded to the revisions of the cited lists
        # and never overrides a positive current claim for the same person.
        if any(
            (person in expected and bool(revisions & historical[statement]))
            or person not in expected and (
                current_claims[statement]
                or not revisions <= historical[statement]
            )
            for statement, person in assertions[group].items()
        ):
            continue
        valid: dict[tuple[Revision, str], list[Fact]] = {}
        for key, statements in lists.items():
            locators: dict[str, set[str]] = defaultdict(set)
            for statement_id, locator in statements:
                locators[statement_id].add(locator)
            members = [
                replace(loaded[s], evidence=tuple(
                    e for e in loaded[s].evidence if e.locator in locators[s]
                ))
                for s in sorted(locators) if s in loaded
            ]
            actual = {f.value_entity.wikidata_id for f in members if f.value_entity}
            if actual != expected or any(
                not f.evidence or not _period_allows(f, reference_date) for f in members
            ):
                break
            valid[key] = members
        else:
            # Use one complete list, the newest cited revision; do not mix
            # evidence across lists. Ties break on source identity and text.
            newest = max(valid, key=lambda key: (key[0][2], key[0][0], key[0][1], key[1]))
            selected.extend(valid[newest])
    return selected
