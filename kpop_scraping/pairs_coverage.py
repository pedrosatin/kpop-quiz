"""Closed revision rosters for evidence-backed idol/group matching."""

from __future__ import annotations

import gzip
import hashlib
import itertools
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from .infobox import infobox_fields
from .quiz_repository import _load_entities, _load_facts
from .quiz_utils import hash_payload

VERSION = "pairs-coverage-v1"
SEMANTICS = "listed_in_current_members_of_each_cited_revision"
LINK = re.compile(r"\[\[([^\[\]|#:\n]+)(?:\|[^\[\]\n]+)?\]\]")


def strict_roster(text: str) -> tuple[list[str], tuple[int, int]]:
    """Accept only an entirely accounted-for list; unsupported text fails closed."""
    fields = infobox_fields(text)
    if len(re.findall(r"\|\s*current_members\s*=", text, re.I)) != 1:
        raise ValueError("missing_or_duplicate_current_members")
    if "current_members" not in fields:
        raise ValueError("missing_current_members")
    span = fields["current_members"]
    raw = text[slice(*span)].strip()
    wrapper = re.fullmatch(r"\{\{\s*(plainlist|ubl|hlist|unbulleted list)\s*\|(.*)\}\}", raw, re.I | re.S)
    if wrapper:
        raw = wrapper.group(2)
    links = list(LINK.finditer(raw))
    rest = LINK.sub("", raw)
    rest = re.sub(r"<br\s*/?>", "", rest, flags=re.I)
    if not links or re.sub(r"[\s*|]", "", rest):
        raise ValueError("unparsed_roster_content")
    names = [m.group(1).replace("_", " ").strip() for m in links]
    if len(set(names)) != len(names):
        raise ValueError("duplicate_roster_names")
    return names, span


def measure(connection: sqlite3.Connection, raw_root: Path, size: int = 4) -> dict:
    """Read accepted facts and hash-verified snapshots without mutating either."""
    if size not in (4, 5, 6):
        raise ValueError("size must be 4, 5 or 6")
    connection.row_factory = sqlite3.Row
    entities = _load_entities(connection)
    facts, rejected = _load_facts(connection, entities)
    names: dict[str, set[str]] = defaultdict(set)
    by_qid = {e.wikidata_id: e for e in entities.values()}
    for e in entities.values():
        if e.entity_type == "person":
            for name in e.identity_names():
                names[name.replace("_", " ").strip().casefold()].add(e.wikidata_id)
    relations = defaultdict(list)
    for f in facts:
        if f.predicate == "has_member" and f.value_entity and f.subject.entity_type == "group" and f.value_entity.entity_type == "person":
            relations[(f.subject.wikidata_id, f.value_entity.wikidata_id)].append(f)
    excluded = Counter()
    rosters = {}
    rows = connection.execute("""
        SELECT sp.wikidata_id, sp.language, sp.external_page_id,
               sr.external_revision_id, sw.snapshot_path, sw.content_sha256
        FROM source_pages sp JOIN source_revisions sr ON sr.source_page_id=sp.id
             AND sr.external_revision_id=sp.revision_id
        JOIN source_revision_wikitext sw ON sw.source_revision_id=sr.id
        ORDER BY sp.wikidata_id, sp.language, sr.external_revision_id
    """)
    for row in rows:
        group = row["wikidata_id"]
        if group not in by_qid or by_qid[group].entity_type != "group":
            continue
        try:
            path = (raw_root / row["snapshot_path"]).resolve()
            if not path.is_relative_to(raw_root.resolve()):
                raise ValueError("snapshot_outside_raw_root")
            content = gzip.open(path, "rb").read() if path.suffix == ".gz" else path.read_bytes()
            if hashlib.sha256(content).hexdigest() != row["content_sha256"]:
                raise ValueError("snapshot_hash_mismatch")
            snapshot = json.loads(content)
            if snapshot.get("revid") != row["external_revision_id"] or snapshot.get("pageid") != row["external_page_id"]:
                raise ValueError("snapshot_identity_mismatch")
            listed, span = strict_roster(snapshot["wikitext"])
            members = {}
            for name in listed:
                ids = names.get(name.casefold(), set())
                if len(ids) != 1:
                    raise ValueError("unresolved_roster_identity")
                person = next(iter(ids))
                if not re.fullmatch(r"Q[1-9][0-9]*", person) or not re.fullmatch(r"Q[1-9][0-9]*", group):
                    raise ValueError("invalid_qid")
                ev = [e.payload() for f in relations.get((group, person), ()) for e in f.evidence
                      if e.revision_id == row["external_revision_id"]
                      and e.source_url == f"https://{row['language']}.wikipedia.org/w/index.php?curid={row['external_page_id']}&oldid={row['external_revision_id']}"
                      and _inside_field(e.locator, span, row['language'], row['external_page_id'], row['external_revision_id'])]
                if not ev:
                    raise ValueError("missing_roster_relation_evidence")
                if person in members:
                    raise ValueError("duplicate_roster_identity")
                members[person] = sorted(ev, key=lambda e: (e["fact_base_id"], e["locator"]))
            rosters.setdefault(group, {"members": members, "evidence": {
                "source_url": f"https://{row['language']}.wikipedia.org/w/index.php?curid={row['external_page_id']}&oldid={row['external_revision_id']}",
                "revision_id": row["external_revision_id"], "locator": f"infobox.current_members:{span[0]}:{span[1]}",
                "snapshot_sha256": row["content_sha256"],
            }})
        except (OSError, ValueError, KeyError, TypeError) as exc:
            excluded[str(exc) if isinstance(exc, ValueError) else type(exc).__name__] += 1
    sample = None
    # Bounded, conservative search. Private representatives yield one matching.
    searched = 0
    for groups in itertools.combinations(sorted(rosters), size):
        searched += 1
        if searched > 20000:
            break
        people = []
        for group in groups:
            choices = set(rosters[group]["members"])
            for other in groups:
                if other != group:
                    choices -= set(rosters[other]["members"])
            if not choices:
                break
            people.append(sorted(choices)[0])
        if len(people) != size:
            continue
        sample = {
            "semantics": SEMANTICS, "period": "each_source_revision_only",
            "pairs": [{"person_id": p, "person_name": by_qid[p].canonical_name,
                       "group_id": g, "group_name": by_qid[g].canonical_name,
                       "evidence": rosters[g]["members"][p]} for g, p in zip(groups, people)],
            "matrix": [{"person_id": p, "group_id": g,
                        "state": "true" if p in rosters[g]["members"] else "false",
                        "evidence": rosters[g]["evidence"]} for p in people for g in groups],
            "matching_count": 1,
        }
        break
    report = {"schema_version": VERSION, "requested_pairs": size,
              "status": "ready" if sample else "insufficient_coverage",
              "semantics": SEMANTICS, "accepted_relation_pairs": len(relations),
              "closed_rosters": len(rosters), "rejected_facts": dict(sorted(rejected.items())),
              "rejected_rosters": dict(sorted(excluded.items())), "searched_group_sets": min(searched, 20000),
              "search_complete": searched <= 20000,
              "selection_policy": "private_representatives_only",
              "limitations": ["Missing relations remain unknown outside fully resolved current_members fields.",
                              "Revision rosters do not establish present-day or lifetime membership.",
                              "Insufficiency describes this conservative selection policy, not every possible unique matching."],
              "sample": sample}
    report["report_id"] = hash_payload(report)
    return report


def _inside_field(locator: str, span: tuple[int, int], language: str,
                  page_id: int, revision_id: int) -> bool:
    prefix = f"wikipedia:{language}:pageid={page_id}:revid={revision_id}"
    match = re.fullmatch(re.escape(prefix) + r"#wikitext\[(\d+):(\d+)\]", locator)
    return bool(match and span[0] <= int(match[1]) < int(match[2]) <= span[1])
