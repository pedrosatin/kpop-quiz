"""Time limit for loading accepted facts next to many open conflicts.

Every generator loads the facts again. The timed input below is one group with 5000 accepted members and 5000
member statements in conflict, 50 of them on an accepted member. The old code
compared each accepted fact with every conflict and took 9.4 s of CPU time on a
laptop with Python 3.12 (10.7 s with Python 3.14). The current code reads the
conflicts once into an index by subject and predicate and takes about 0.07 s,
so the one-second limit leaves a wide margin for a slow machine.
The other tests compare the index with the scan it replaced.
"""

import os
import random
import subprocess
import sys
import time
import unittest
from pathlib import Path

from kpop_scraping.quiz_repository import (
    _has_open_conflict,
    _load_entities,
    _load_facts,
    _open_conflict_index,
)
from tests.test_quiz_generator import build_quiz_database

LIMIT_SECONDS = 1.0
ROOT = Path(__file__).resolve().parent.parent
SUPPORTED = (
    "formed_on", "born_on", "has_member", "member_of", "record_label",
    "performed_by", "released_on",
)
# The fixture loads every accepted fact but the one its conflict blocks.
FIXTURE_LOADED = [
    *(f"born-{i}" for i in range(1, 8)),
    *(f"formation-{i}" for i in range(1, 8)),
    *(f"has-{i}" for i in range(1, 8)),
    *(f"label-{i}" for i in range(1, 8)),
    *(f"member-{i}" for i in range(1, 8)),
    *(f"performer-{i}" for i in range(1, 9)),
    *(f"released-{i}" for i in range(1, 9)),
]
FIXTURE_REJECTED = {
    "fact_conflict__same_rank_values_differ": 1,
    "fact_rejected__missing_evidence": 1,
    "open_conflict": 1,
}


def scanned_open_conflict(row, conflicts):
    """The scan the index replaced, kept as the reference of the tests."""
    for conflict in conflicts:
        if (
            conflict["subject_entity_id"] != row["subject_entity_id"]
            or conflict["predicate"] != row["predicate"]
        ):
            continue
        if row["predicate"] in {"has_member", "member_of", "record_label", "performed_by"}:
            if conflict["value_entity_id"] == row["value_entity_id"]:
                return True
        else:
            return True
    return False


def insert_fact(connection, statement_id, subject, predicate, value, status,
                value_time=None, evidence=True):
    cursor = connection.execute(
        """
        INSERT INTO facts(
            statement_id, subject_entity_id, predicate, property_id, rank,
            value_entity_id, value_time, value_precision, qualifiers_json,
            references_json, status, status_reason, quality_flags_json,
            extractor_version
        ) VALUES (?, ?, ?, 'PTEST', 'normal', ?, ?, ?, '{}', '[]', ?, ?, '[]', 'fixture-v1')
        """,
        (
            statement_id, subject, predicate, value, value_time,
            11 if value_time else None, status,
            "same_rank_values_differ" if status == "conflict" else None,
        ),
    )
    if evidence:
        connection.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', ?, 'ref', 1)
            """,
            (cursor.lastrowid, f"claims/PTEST/{statement_id}/references/ref"),
        )


def loaded(connection):
    facts, rejected = _load_facts(connection, _load_entities(connection))
    return [fact.statement_id for fact in facts], dict(rejected)


def random_rows(rng, count):
    """Rows that share subjects, predicates and values often."""
    rows = []
    for index in range(count):
        predicate = rng.choice(SUPPORTED + ("born_in",))
        rows.append({
            "statement_id": f"s{index:03d}",
            "subject_entity_id": rng.choice((1, 2, 3)),
            "predicate": predicate,
            "value_entity_id": rng.choice((None, 10, 11, 12)),
            "value_time": rng.choice((None, "2020-01-01", "2021-01-01")),
            "status": rng.choice(("accepted", "accepted", "conflict", "rejected")),
        })
    rng.shuffle(rows)
    return rows


class TimeLimitTest(unittest.TestCase):
    def test_many_accepted_members_next_to_many_conflicts(self):
        connection = build_quiz_database()
        self.addCleanup(connection.close)
        group = connection.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES ('QBIG', 'group', 'Big')"
        ).lastrowid
        people = [
            connection.execute(
                "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
                (f"QM{index:04d}", f"Member {index}"),
            ).lastrowid
            for index in range(5000)
        ]
        for index, person in enumerate(people):
            insert_fact(connection, f"big-has-{index:04d}", group, "has_member", person, "accepted")
            # Every hundredth conflict names an accepted member, the others no one.
            value = person if index % 100 == 0 else 100000 + index
            insert_fact(connection, f"big-conflict-{index:04d}", group, "has_member", value,
                        "conflict", evidence=False)
        entities = _load_entities(connection)
        start = time.process_time()
        facts, rejected = _load_facts(connection, entities)
        self.assertLess(time.process_time() - start, LIMIT_SECONDS)
        big = [fact.statement_id for fact in facts if fact.statement_id.startswith("big-")]
        self.assertEqual(big, [f"big-has-{i:04d}" for i in range(5000) if i % 100])
        self.assertEqual(rejected["open_conflict"], 50 + 1)
        self.assertEqual(rejected["fact_conflict__same_rank_values_differ"], 5000 + 1)


class ConflictIndexTest(unittest.TestCase):
    def assertSameAsScan(self, rows):
        conflicts = [row for row in rows if row["status"] == "conflict"]
        index = _open_conflict_index(conflicts)
        for row in rows:
            if row["status"] == "accepted":
                self.assertEqual(
                    _has_open_conflict(row, index), scanned_open_conflict(row, conflicts), row
                )

    def test_cases_the_scan_told_apart(self):
        def row(subject, predicate, value=None, status="accepted", value_time=None):
            return {"subject_entity_id": subject, "predicate": predicate,
                    "value_entity_id": value, "value_time": value_time, "status": status}

        cases = {
            "fact without conflict": ([row(1, "has_member", 10)], [False]),
            "conflict without fact": ([row(1, "has_member", 10, "conflict")], []),
            "same member": ([row(1, "has_member", 10), row(1, "has_member", 10, "conflict")], [True]),
            "other member": ([row(1, "has_member", 10), row(1, "has_member", 11, "conflict")], [False]),
            "other subject": ([row(1, "has_member", 10), row(2, "has_member", 10, "conflict")], [False]),
            "other predicate": ([row(1, "has_member", 10), row(1, "member_of", 10, "conflict")], [False]),
            "missing value on both": ([row(1, "record_label"), row(1, "record_label", None, "conflict")], [True]),
            "missing value on one": ([row(1, "record_label"), row(1, "record_label", 10, "conflict")], [False]),
            # A dated predicate is blocked by any conflict on it, whatever its value.
            "other date": ([row(1, "formed_on", value_time="2020"),
                            row(1, "formed_on", status="conflict", value_time="2021")], [True]),
            "date of another subject": ([row(1, "born_on", value_time="2020"),
                                         row(2, "born_on", status="conflict", value_time="2020")], [False]),
            "several conflicts on one key": (
                [row(1, "performed_by", 10), row(1, "performed_by", 12),
                 row(1, "performed_by", 11, "conflict"), row(1, "performed_by", 12, "conflict")],
                [False, True],
            ),
            "rejected is not a conflict": ([row(1, "has_member", 10), row(1, "has_member", 10, "rejected")], [False]),
        }
        for name, (rows, expected) in cases.items():
            with self.subTest(name):
                conflicts = [r for r in rows if r["status"] == "conflict"]
                index = _open_conflict_index(conflicts)
                accepted = [r for r in rows if r["status"] == "accepted"]
                self.assertEqual([_has_open_conflict(r, index) for r in accepted], expected)
                self.assertEqual([scanned_open_conflict(r, conflicts) for r in accepted], expected)

    def test_generated_rows_give_the_answer_of_the_scan(self):
        rng = random.Random(14)
        for _ in range(400):
            self.assertSameAsScan(random_rows(rng, rng.randrange(0, 16)))

    def test_generated_databases_load_what_the_scan_loaded(self):
        rng = random.Random(1129)
        for case in range(60):
            rows = random_rows(rng, rng.randrange(0, 24))
            connection = build_quiz_database()
            # The fixture's own rows stay; the generated ones use their own entities.
            for entity_id in (1, 2, 3, 10, 11, 12):
                connection.execute(
                    "INSERT INTO entities(id, wikidata_id, entity_type, canonical_name) VALUES (?, ?, 'group', ?)",
                    (1000 + entity_id, f"QX{entity_id}", f"X {entity_id}"),
                )
            for row in rows:
                value = row["value_entity_id"]
                insert_fact(
                    connection, row["statement_id"], 1000 + row["subject_entity_id"],
                    row["predicate"], None if value is None else 1000 + value, row["status"],
                    value_time=row["value_time"],
                )
            statements, rejected = loaded(connection)
            connection.close()
            conflicts = [r for r in rows if r["status"] == "conflict"]
            accepted = sorted(
                (r for r in rows if r["status"] == "accepted" and r["predicate"] in SUPPORTED),
                key=lambda r: r["statement_id"],
            )
            expected = [r["statement_id"] for r in accepted if not scanned_open_conflict(r, conflicts)]
            with self.subTest(case=case):
                self.assertEqual([s for s in statements if s.startswith("s")], expected)
                self.assertEqual(
                    rejected.get("open_conflict", 0),
                    FIXTURE_REJECTED["open_conflict"] + len(accepted) - len(expected),
                )


class FixtureTest(unittest.TestCase):
    def test_fixture_loads_the_same_facts_in_either_insertion_order(self):
        for reverse in (False, True):
            connection = build_quiz_database(reverse=reverse)
            with self.subTest(reverse=reverse):
                statements, rejected = loaded(connection)
                self.assertEqual(statements, sorted(FIXTURE_LOADED))
                self.assertEqual(rejected, FIXTURE_REJECTED)
            connection.close()

    def test_loaded_facts_do_not_depend_on_the_hash_seed(self):
        script = (
            "from kpop_scraping.quiz_repository import _load_entities, _load_facts\n"
            "from tests.test_quiz_generator import build_quiz_database\n"
            "connection = build_quiz_database()\n"
            "facts, rejected = _load_facts(connection, _load_entities(connection))\n"
            "print([repr(fact) for fact in facts], sorted(rejected.items()))\n"
        )
        outputs = set()
        for seed in ("0", "1", "4242"):
            result = subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                cwd=ROOT,
                env={**os.environ, "PYTHONHASHSEED": seed},
                check=True,
                text=True,
                timeout=60,
            )
            outputs.add(result.stdout)
        self.assertEqual(len(outputs), 1)
        output = outputs.pop()
        self.assertIn("'formation-1'", output)
        self.assertNotIn("'conflict-accepted'", output)


if __name__ == "__main__":
    unittest.main()
