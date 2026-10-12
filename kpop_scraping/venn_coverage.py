"""Conservative Venn eligibility using complete, cited Gregorian birth dates."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date

RULES_VERSION = "venn-birth-coverage-v1"
GREGORIAN = "http://www.wikidata.org/entity/Q1985727"


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def _support(connection):
    result = defaultdict(list)
    for row in connection.execute("""
        SELECT fe.*, f.statement_id, e.wikidata_id AS subject_qid, ws.wikidata_id, ws.external_revision_id AS wd_revision,
               sr.external_revision_id AS wp_revision, sp.external_page_id, sp.language,
               sp.wikidata_id AS wp_subject_qid
        FROM fact_evidence fe JOIN facts f ON f.id=fe.fact_id
        JOIN entities e ON e.id=f.subject_entity_id
        LEFT JOIN wikidata_entity_snapshots ws ON ws.id=fe.wikidata_snapshot_id
        LEFT JOIN source_revisions sr ON sr.id=fe.source_revision_id
        LEFT JOIN source_pages sp ON sp.id=sr.source_page_id
        WHERE f.predicate='born_on' ORDER BY f.statement_id, fe.locator, fe.source_key
    """):
        if not row["locator"] or not row["source_key"]:
            continue
        if row["evidence_type"] == "wikidata_reference":
            revision = row["wd_revision"]
            if row["wikidata_id"] != row["subject_qid"]:
                continue
            reference_hash = row["reference_hash"]
            if (not isinstance(reference_hash, str)
                    or not re.fullmatch(r"[0-9a-f]{40}", reference_hash)
                    or not re.fullmatch(r"Q[1-9]\d*", row["wikidata_id"] or "")
                    or not isinstance(row["statement_id"], str)
                    or not row["statement_id"].startswith(row["subject_qid"] + "$")):
                continue
            expected_locator = f"claims/P569/{row['statement_id']}/references/{reference_hash}"
            if row["locator"] != expected_locator:
                continue
            url = f"https://www.wikidata.org/w/index.php?title=Special:EntityPage/{row['wikidata_id']}&oldid={revision}"
        elif row["evidence_type"] == "wikipedia_revision":
            revision = row["wp_revision"]
            if (not row["snippet"] or type(row["external_page_id"]) is not int
                    or row["external_page_id"] <= 0
                    or row["wp_subject_qid"] != row["subject_qid"]
                    or not re.fullmatch(r"[a-z-]+", row["language"] or "")):
                continue
            locator = re.fullmatch(r"wikipedia:([a-z-]+):pageid=([1-9][0-9]*):revid=([1-9][0-9]*)#(?:extract|wikitext)\[(\d+):(\d+)\]", row["locator"])
            if (not locator or locator[1] != row["language"]
                    or int(locator[2]) != row["external_page_id"]
                    or int(locator[3]) != revision or int(locator[4]) >= int(locator[5])):
                continue
            url = f"https://{row['language']}.wikipedia.org/w/index.php?curid={row['external_page_id']}&oldid={revision}"
        else:
            continue
        if type(revision) is not int or revision <= 0:
            continue
        result[row["fact_id"]].append({"fact_base_id": row["statement_id"],
            "source_key": row["source_key"], "locator": row["locator"],
            "revision_id": revision, "source_url": url})
    return result


def generate_venn_coverage(connection: sqlite3.Connection, reference_date: str):
    """Read only. Return every candidate, rejection, bounded triple and a sample."""
    reference = date.fromisoformat(reference_date)
    connection.row_factory = sqlite3.Row
    support = _support(connection)
    facts = defaultdict(list)
    for row in connection.execute("SELECT * FROM facts WHERE predicate='born_on' ORDER BY statement_id"):
        facts[row["subject_entity_id"]].append(row)
    candidates = []
    for entity in connection.execute("SELECT * FROM entities WHERE entity_type='person' ORDER BY wikidata_id"):
        rows = facts[entity["id"]]
        active = [r for r in rows if r["status"] not in {"superseded", "stale"}]
        reasons = set()
        accepted = [r for r in active if r["status"] == "accepted"]
        dates = set()
        evidence = []
        if not re.fullmatch(r"Q[1-9]\d*", entity["wikidata_id"]):
            reasons.add("invalid_qid")
        if not entity["canonical_name"].strip():
            reasons.add("missing_name")
        if not accepted:
            reasons.add("missing_accepted_birth")
        if any(r["status"] == "conflict" for r in active):
            reasons.add("open_conflict")
        for row in accepted:
            raw = row["value_time"]
            try:
                if not isinstance(raw, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
                    raise ValueError()
                born = date.fromisoformat(raw)
                if born > reference:
                    raise ValueError()
                dates.add(raw)
            except ValueError:
                reasons.add("invalid_or_incomplete_date")
            if row["value_precision"] != 11:
                reasons.add("insufficient_precision")
            if row["value_calendar"] != GREGORIAN:
                reasons.add("unsupported_calendar")
            if row["property_id"] != "P569":
                reasons.add("inconsistent_property")
            if not support[row["id"]]:
                reasons.add("missing_evidence")
            evidence.extend(support[row["id"]])
        if len(dates) > 1:
            reasons.add("inconsistent_dates")
        known = not reasons and len(dates) == 1
        candidates.append({"qid": entity["wikidata_id"], "name": entity["canonical_name"],
            "birth_date": next(iter(dates)) if known else None,
            "state": "known" if known else "unknown", "reasons": sorted(reasons),
            "evidence": sorted(evidence, key=lambda e: (e["fact_base_id"], e["locator"], e["source_key"])) if known else []})
    known = [c for c in candidates if c["state"] == "known"]
    # Only year thresholds observed in the declared pool; deterministic finite search.
    thresholds = sorted({int(c["birth_date"][:4]) + 1 for c in known})
    triples = []
    sample = None
    for year in thresholds:
        regions = {str(mask): [] for mask in range(8)}
        classifications = []
        for item in candidates:
            values = [None, None, None]
            mask = None
            if item["state"] == "known":
                born = date.fromisoformat(item["birth_date"])
                values = [born.year < year, born.month <= 6, born.day <= 15]
                mask = sum((1 << i) for i, value in enumerate(values) if value)
                regions[str(mask)].append(item["qid"])
            classifications.append({"qid": item["qid"], "values": values, "mask": mask})
        counts = {key: len(value) for key, value in regions.items()}
        eligible = all(counts[str(mask)] for mask in range(1, 8))
        categories = [{"id": "birth_before_year", "year": year,
                       "label": {"pt-BR": f"Nasceu antes de {year}", "en": f"Born before {year}"}},
                      {"id": "birth_first_half", "label": {"pt-BR": "Nasceu entre janeiro e junho", "en": "Born January–June"}},
                      {"id": "birth_first_fifteen_days", "label": {"pt-BR": "Nasceu entre os dias 1 e 15", "en": "Born on days 1–15"}}]
        triples.append({"categories": categories, "region_counts": counts,
                        "classifications": classifications, "eligible": eligible})
        if eligible and sample is None:
            by_qid = {c["qid"]: c for c in known}
            sample = {"schema_version": 1, "rules_version": RULES_VERSION,
                      "reference_date": reference_date, "categories": categories,
                      "entities": [{**by_qid[regions[str(mask)][0]], "mask": mask,
                                    "values": [bool(mask & (1 << i)) for i in range(3)]}
                                   for mask in range(1, 8)]}
    version = _digest({"rules_version": RULES_VERSION, "reference_date": reference_date,
                       "candidates": candidates})
    if sample:
        sample["dataset_version"] = version
        sample["sample_id"] = _digest(sample)
    return {"schema_version": 1, "rules_version": RULES_VERSION,
            "dataset_version": version, "reference_date": reference_date,
            "status": "approved" if sample else "insufficient_coverage",
            "category_search": "birth year threshold × January–June × day 1–15; bit order 1,2,4",
            "person_count": len(candidates), "eligible_count": len(known),
            "unknown_count": len(candidates) - len(known),
            "rejection_counts": dict(sorted(Counter(r for c in candidates for r in c["reasons"]).items())),
            "candidates": candidates, "triples": triples, "sample": sample}


def verify_venn_coverage(report, connection):
    """Verify structure and all semantics against the declared read-only input."""
    if not isinstance(report, dict) or not isinstance(report.get("reference_date"), str):
        raise ValueError("Invalid Venn coverage report")
    expected = generate_venn_coverage(connection, report["reference_date"])
    if _digest(report) != _digest(expected):
        raise ValueError("Venn coverage report differs from the declared database/rules")
