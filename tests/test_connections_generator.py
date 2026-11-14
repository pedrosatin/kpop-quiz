"""Unit tests for connections puzzle generator, partition uniqueness solver, and CLI."""

from __future__ import annotations

import io
import json
import os
import random
import sqlite3
import subprocess
import sys
import tempfile
import time
import tracemalloc
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.connections_cli import main as cli_main
from kpop_scraping.connections_generator import (
    MEMBER_COUNT_CRITERIA,
    _find_disjoint_assignment,
    _load_criterion_groups,
    _SearchBudget,
    count_valid_partitions,
    evaluate_connections_criteria,
    generate_connections_puzzle,
    member_count_conflicts,
)
from kpop_scraping.connections_schema import validate_connections_puzzle
from kpop_scraping.quiz_repository import (
    _groups_with_complete_members,
    _load_entities,
    _load_facts,
)


CONNECTIONS_TEST_SCHEMA = """
        CREATE TABLE entities (
            id INTEGER PRIMARY KEY,
            wikidata_id TEXT NOT NULL UNIQUE,
            entity_type TEXT NOT NULL,
            canonical_name TEXT NOT NULL
        );
        CREATE TABLE entity_aliases (
            entity_id INTEGER,
            language TEXT,
            name TEXT,
            alias_type TEXT
        );
        CREATE TABLE facts (
            id INTEGER PRIMARY KEY,
            statement_id TEXT NOT NULL UNIQUE,
            subject_entity_id INTEGER NOT NULL,
            predicate TEXT NOT NULL,
            property_id TEXT,
            rank TEXT,
            value_wikidata_id TEXT,
            value_entity_id INTEGER,
            value_time TEXT,
            value_precision INTEGER,
            valid_from TEXT,
            valid_from_precision INTEGER,
            valid_to TEXT,
            valid_to_precision INTEGER,
            qualifiers_json TEXT,
            references_json TEXT,
            status TEXT NOT NULL,
            status_reason TEXT,
            quality_flags_json TEXT,
            extractor_version TEXT
        );
        CREATE TABLE wikidata_entity_snapshots (
            id INTEGER PRIMARY KEY,
            wikidata_id TEXT,
            external_revision_id INTEGER
        );
        CREATE TABLE source_pages (
            id INTEGER PRIMARY KEY,
            provider TEXT,
            language TEXT,
            external_page_id INTEGER
        );
        CREATE TABLE source_revisions (
            id INTEGER PRIMARY KEY,
            source_page_id INTEGER,
            external_revision_id INTEGER
        );
        CREATE TABLE fact_evidence (
            fact_id INTEGER,
            evidence_type TEXT,
            source_key TEXT,
            locator TEXT,
            reference_hash TEXT,
            snippet TEXT,
            wikidata_snapshot_id INTEGER,
            source_revision_id INTEGER
        );
        """


def build_connections_test_database(reverse: bool = False) -> sqlite3.Connection:
    """Create an in-memory SQLite database populated with test entities, facts, and evidence."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(CONNECTIONS_TEST_SCHEMA)
    conn.execute(
        "INSERT INTO wikidata_entity_snapshots VALUES (1, 'QSOURCE', 1001)"
    )

    labels = [
        ("Q483238", "organization", "JYP Entertainment"),
        ("Q483957", "organization", "SM Entertainment"),
        ("Q483471", "organization", "YG Entertainment"),
        ("Q106399432", "organization", "HYBE"),
    ]
    entity_ids: dict[str, int] = {}
    label_iter = reversed(labels) if reverse else labels
    for qid, etype, cname in label_iter:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
            (qid, etype, cname),
        )
        entity_ids[qid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, cname),
        )

    # 20 groups: Q101 to Q120
    # Labels distribution: 5 groups per record label
    group_labels: dict[int, str] = {
        101: "Q483238", 102: "Q483238", 103: "Q483238", 104: "Q483238", 105: "Q483238",
        106: "Q483957", 107: "Q483957", 108: "Q483957", 109: "Q483957", 110: "Q483957",
        111: "Q483471", 112: "Q483471", 113: "Q483471", 114: "Q483471", 115: "Q483471",
        116: "Q106399432", 117: "Q106399432", 118: "Q106399432", 119: "Q106399432", 120: "Q106399432",
    }

    # Debut years: 2000s (4 groups), 2010s (8 groups), 2020s (8 groups)
    years: dict[int, int] = {
        101: 2004, 102: 2012, 103: 2015, 104: 2021, 105: 2023,
        106: 2007, 107: 2014, 108: 2016, 109: 2022, 110: 2024,
        111: 2006, 112: 2013, 113: 2017, 114: 2020, 115: 2023,
        116: 2009, 117: 2015, 118: 2018, 119: 2021, 120: 2024,
    }

    # Member counts:
    # 4 members (4 groups): 101, 106, 111, 116
    # 5 members (4 groups): 102, 107, 112, 117
    # 7 members (4 groups): 103, 108, 113, 118
    # 9 members (4 groups): 104, 109, 114, 119
    # 6 members (4 groups): 105, 110, 115, 120
    member_counts: dict[int, int] = {
        101: 4, 102: 5, 103: 7, 104: 9, 105: 6,
        106: 4, 107: 5, 108: 7, 109: 9, 110: 6,
        111: 4, 112: 5, 113: 7, 114: 9, 115: 6,
        116: 4, 117: 5, 118: 7, 119: 9, 120: 6,
    }

    numbers = list(reversed(range(101, 121))) if reverse else list(range(101, 121))
    for num in numbers:
        qid = f"Q{num}"
        cname = f"Test Group {num}"
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'group', ?)",
            (qid, cname),
        )
        entity_ids[qid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, cname),
        )

    # Person entities for has_member
    base_person_offsets: dict[int, int] = {}
    curr_offset = 1
    for n in range(101, 121):
        base_person_offsets[n] = curr_offset
        curr_offset += member_counts[n]

    for num in numbers:
        count = member_counts[num]
        base_idx = base_person_offsets[num]
        for offset in range(count):
            person_idx = base_idx + offset
            pqid = f"Q{2000 + person_idx}"
            pname = f"Member {person_idx}"
            cur = conn.execute(
                "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
                (pqid, pname),
            )
            entity_ids[pqid] = cur.lastrowid
            conn.execute(
                "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
                (cur.lastrowid, pname),
            )
            cur_f = conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    value_wikidata_id, value_entity_id, status, quality_flags_json
                ) VALUES (?, ?, 'has_member', 'P527', 'normal', ?, ?, 'accepted', '[]')
                """,
                (f"has-{num}-{person_idx}", entity_ids[f"Q{num}"], pqid, cur.lastrowid),
            )
            conn.execute(
                """
                INSERT INTO fact_evidence(
                    fact_id, evidence_type, source_key, locator, reference_hash,
                    wikidata_snapshot_id
                ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'refhash', 1)
                """,
                (cur_f.lastrowid, f"claims/P527/has-{num}-{person_idx}"),
            )

    # formed_on and record_label facts
    for num in numbers:
        gid = entity_ids[f"Q{num}"]
        y = years[num]
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'formed_on', 'P571', 'normal', ?, 9, 'accepted', '[]')
            """,
            (f"formed-{num}", gid, f"{y}"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'refhash', 1)
            """,
            (cur_f.lastrowid, f"claims/P571/formed-{num}"),
        )

        lbl_qid = group_labels[num]
        lbl_id = entity_ids[lbl_qid]
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'record_label', 'P264', 'normal', ?, ?, 'accepted', '[]')
            """,
            (f"label-{num}", gid, lbl_qid, lbl_id),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'refhash', 1)
            """,
            (cur_f.lastrowid, f"claims/P264/label-{num}"),
        )

    conn.commit()
    return conn


# The connections board published for 2026-11-11, by category, with the member
# statements the database held for each group (local base of 2026-10-19; the
# same claims Wikidata serves today). Statuses list one entry per current
# has_member statement; an empty list means the group has none.
PLAYTEST_2026_11_11_LABELS = {
    "Q50595": "YG Entertainment",
    "Q1988428": "Avex Trax",
    "Q38903": "Universal Music Group",
}
PLAYTEST_2026_11_11_BOARD = {
    "label_yg": ("Q50595", ["Q10728972", "Q15116397", "Q18551384", "Q282104"]),
    "label_q1988428": ("Q1988428", ["Q120998562", "Q239693", "Q344286", "Q483706"]),
    "label_q38903": ("Q38903", ["Q16097371", "Q487638", "Q489225", "Q7374722"]),
    "members_3": (None, ["Q130546361", "Q483172", "Q6460281", "Q65269682"]),
}
PLAYTEST_2026_11_11_NAMES = {
    "Q10728972": "AKMU", "Q15116397": "Winner", "Q18551384": "Hi Suhyun",
    "Q282104": "BigBang", "Q120998562": "Super Junior-L.S.S.", "Q239693": "Super Junior",
    "Q344286": "f(x)", "Q483706": "The Grace", "Q16097371": "Boys Republic",
    "Q487638": "F.CUZ", "Q489225": "Rainbow", "Q7374722": "Royal Pirates",
    "Q130546361": "Ablume", "Q483172": "CNBLUE", "Q6460281": "LUV", "Q65269682": "3YE",
}
ACCEPTED, CONFLICT, REJECTED = "accepted", "conflict", "rejected"
PLAYTEST_2026_11_11_MEMBERS: dict[str, list[str]] = {
    "Q10728972": [ACCEPTED, REJECTED],
    "Q15116397": [ACCEPTED] * 4 + [CONFLICT],
    "Q18551384": [],
    # G-Dragon, Taeyang and Daesung accepted; T.O.P and Seungri in conflict
    # (membership_period_unconfirmed): 3 to 5 members by the data.
    "Q282104": [ACCEPTED] * 3 + [CONFLICT] * 2,
    # Leeteuk, Shindong and Siwon, all membership_period_unconfirmed: 0 to 3.
    "Q120998562": [CONFLICT] * 3,
    "Q239693": [],
    "Q344286": [CONFLICT] * 4 + [REJECTED],
    "Q483706": [],
    "Q16097371": [],
    "Q487638": [],
    "Q489225": [CONFLICT] * 3 + [REJECTED],
    "Q7374722": [],
    "Q130546361": [ACCEPTED] * 3,
    "Q483172": [ACCEPTED] * 3,
    "Q6460281": [ACCEPTED] * 3,
    "Q65269682": [ACCEPTED] * 3,
}


def build_playtest_board_database(members: dict[str, list[str]]) -> sqlite3.Connection:
    """Rebuild the 2026-11-11 board: its 16 groups, 3 labels and member statements."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(CONNECTIONS_TEST_SCHEMA)
    conn.execute("INSERT INTO wikidata_entity_snapshots VALUES (1, 'QSOURCE', 1001)")
    ids: dict[str, int] = {}

    def entity(qid: str, etype: str, name: str) -> int:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
            (qid, etype, name),
        )
        for language in ("en", "pt"):
            conn.execute(
                "INSERT INTO entity_aliases VALUES (?, ?, ?, 'label')",
                (cur.lastrowid, language, name),
            )
        ids[qid] = cur.lastrowid
        return cur.lastrowid

    def fact(statement_id: str, subject: str, predicate: str, value: str, status: str) -> None:
        cur = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, status_reason, quality_flags_json
            ) VALUES (?, ?, ?, 'P', 'normal', ?, ?, ?, ?, '[]')
            """,
            (
                statement_id, ids[subject], predicate, value, ids[value], status,
                None if status == ACCEPTED else "membership_period_unconfirmed",
            ),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash, wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'refhash', 1)
            """,
            (cur.lastrowid, f"claims/{statement_id}"),
        )

    for qid, name in PLAYTEST_2026_11_11_LABELS.items():
        entity(qid, "organization", name)
    for qid, name in PLAYTEST_2026_11_11_NAMES.items():
        entity(qid, "group", name)
    for label_qid, group_qids in PLAYTEST_2026_11_11_BOARD.values():
        for qid in group_qids if label_qid else ():
            fact(f"label-{qid}", qid, "record_label", label_qid, ACCEPTED)
    for qid, statuses in members.items():
        for index, status in enumerate(statuses):
            entity(f"{qid}P{index}", "person", f"{qid} member {index}")
            fact(f"has-{qid}-{index}", qid, "has_member", f"{qid}P{index}", status)
    conn.commit()
    return conn


def playtest_conflicts(members: dict[str, list[str]]) -> set[tuple[str, str]]:
    """Conflicts the published 2026-11-11 assignment has under the given data."""
    conn = build_playtest_board_database(members)
    try:
        _, _, _, _, all_criteria, bounds = _load_criterion_groups(conn)
    finally:
        conn.close()
    assignment = {cat: qids for cat, (_label, qids) in PLAYTEST_2026_11_11_BOARD.items()}
    return set(member_count_conflicts(assignment, bounds, all_criteria))


class PartitionUniquenessSolverTest(unittest.TestCase):
    """Unit tests for count_valid_partitions."""

    def test_single_partition(self):
        """Verify solver returns 1 when exactly one valid 4x4 partition exists."""
        candidate_items = [f"item_{i}" for i in range(1, 17)]
        categories_criteria = [
            ("cat_0", {"item_1", "item_2", "item_3", "item_4"}),
            ("cat_1", {"item_5", "item_6", "item_7", "item_8"}),
            ("cat_2", {"item_9", "item_10", "item_11", "item_12"}),
            ("cat_3", {"item_13", "item_14", "item_15", "item_16"}),
        ]
        count = count_valid_partitions(candidate_items, categories_criteria)
        self.assertEqual(count, 1)

    def test_ambiguous_partition(self):
        """Verify solver returns >= 2 when multiple valid 4x4 partitions exist."""
        candidate_items = [f"item_{i}" for i in range(1, 17)]
        # item_1 and item_5 can swap between cat_0 and cat_1
        categories_criteria = [
            ("cat_0", {"item_1", "item_2", "item_3", "item_4", "item_5"}),
            ("cat_1", {"item_1", "item_5", "item_6", "item_7", "item_8"}),
            ("cat_2", {"item_9", "item_10", "item_11", "item_12"}),
            ("cat_3", {"item_13", "item_14", "item_15", "item_16"}),
        ]
        count = count_valid_partitions(candidate_items, categories_criteria, max_count=2)
        self.assertEqual(count, 2)

    def test_no_partition(self):
        """Verify solver returns 0 when no valid 4x4 partition exists."""
        candidate_items = [f"item_{i}" for i in range(1, 17)]
        # cat_0 only has 3 items in the pool
        categories_criteria = [
            ("cat_0", {"item_1", "item_2", "item_3"}),
            ("cat_1", {"item_5", "item_6", "item_7", "item_8"}),
            ("cat_2", {"item_9", "item_10", "item_11", "item_12"}),
            ("cat_3", {"item_13", "item_14", "item_15", "item_16"}),
        ]
        count = count_valid_partitions(candidate_items, categories_criteria)
        self.assertEqual(count, 0)

    def test_edge_cases(self):
        """Verify solver boundary checks."""
        # Less than 16 items
        self.assertEqual(count_valid_partitions([f"item_{i}" for i in range(15)], []), 0)
        # More than 16 items
        self.assertEqual(count_valid_partitions([f"item_{i}" for i in range(17)], []), 0)
        # Duplicate items
        dup_items = [f"item_{i}" for i in range(15)] + ["item_0"]
        self.assertEqual(count_valid_partitions(dup_items, []), 0)
        # Wrong criteria count
        candidate_items = [f"item_{i}" for i in range(16)]
        self.assertEqual(count_valid_partitions(candidate_items, [("c1", set())]), 0)
        # Duplicate category IDs
        dup_cats = [("c1", set()), ("c1", set()), ("c2", set()), ("c3", set())]
        self.assertEqual(count_valid_partitions(candidate_items, dup_cats), 0)
        # Non-positive max_count
        valid_cats = [("c0", set()), ("c1", set()), ("c2", set()), ("c3", set())]
        self.assertEqual(count_valid_partitions(candidate_items, valid_cats, max_count=0), 0)


class ConnectionsGeneratorTest(unittest.TestCase):
    """Unit tests for connections puzzle generator."""

    def setUp(self):
        self.conn = build_connections_test_database()

    def tearDown(self):
        self.conn.close()

    def test_generate_puzzle_conforms_to_schema(self):
        """Verify successful generation and validation against schema contract."""
        puzzle = generate_connections_puzzle(self.conn, seed="connections-test-seed-1")
        validate_connections_puzzle(puzzle)

        self.assertEqual(puzzle["schema_version"], "kpop-connections-puzzle-v1")
        self.assertEqual(len(puzzle["puzzle_id"]), 64)
        self.assertEqual(len(puzzle["dataset_version"]), 64)
        self.assertEqual(puzzle["dimensions"], {"groups": 4, "items_per_group": 4, "total_items": 16})

        self.assertEqual(len(puzzle["categories"]), 4)
        self.assertEqual(len(puzzle["items"]), 16)

        difficulty_levels = [cat["difficulty_level"] for cat in puzzle["categories"]]
        self.assertEqual(sorted(difficulty_levels), [1, 2, 3, 4])

        # Verify all items in categories are disjoint and match items pool
        seen_cat_items: set[str] = set()
        for cat in puzzle["categories"]:
            item_ids = cat["item_ids"]
            self.assertEqual(len(item_ids), 4)
            self.assertTrue(seen_cat_items.isdisjoint(set(item_ids)))
            seen_cat_items.update(item_ids)
            self.assertTrue(len(cat["evidence"]) >= 1)

        pool_ids = {item["id"] for item in puzzle["items"]}
        self.assertEqual(seen_cat_items, pool_ids)

    def test_wikipedia_notes_in_labels_stay_published_and_do_not_move_the_puzzle(self):
        """Labels reach the artifact as collected; the page decides what to hide.

        The shuffle and the categories come from the seed, so renaming two
        homonyms changes label text and nothing else the player could resume.
        """
        baseline = generate_connections_puzzle(self.conn, seed="labels-seed")
        first, second = sorted(item["canonical_name"] for item in baseline["items"])[:2]
        self.conn.execute(
            "UPDATE entity_aliases SET name='Tempest (grupo)' WHERE language='pt' AND name=?", (first,)
        )
        self.conn.execute(
            "UPDATE entity_aliases SET name='Tempest (banda)' WHERE language='pt' AND name=?", (second,)
        )
        renamed = generate_connections_puzzle(self.conn, seed="labels-seed")

        labels = {item["canonical_name"]: item["labels"]["pt-BR"] for item in renamed["items"]}
        self.assertEqual(labels[first], "Tempest (grupo)")
        self.assertEqual(labels[second], "Tempest (banda)")
        self.assertEqual(renamed["categories"], baseline["categories"])
        self.assertEqual(
            [item["id"] for item in renamed["items"]],
            [item["id"] for item in baseline["items"]],
        )
        validate_connections_puzzle(renamed)

    def test_determinism_same_seed(self):
        """Verify identical seed produces identical puzzle_id and content."""
        puzzle1 = generate_connections_puzzle(self.conn, seed="deterministic-seed")
        puzzle2 = generate_connections_puzzle(self.conn, seed="deterministic-seed")
        self.assertEqual(puzzle1["puzzle_id"], puzzle2["puzzle_id"])
        self.assertEqual(puzzle1, puzzle2)

    def test_different_seeds_produce_different_puzzles(self):
        """Verify different seeds produce different puzzles."""
        puzzle1 = generate_connections_puzzle(self.conn, seed="seed-alpha-1")
        puzzle2 = generate_connections_puzzle(self.conn, seed="seed-beta-2")
        self.assertNotEqual(puzzle1["puzzle_id"], puzzle2["puzzle_id"])

    def test_database_insertion_order_invariance(self):
        """Verify insertion order does not affect generated puzzle."""
        conn_asc = build_connections_test_database(reverse=False)
        conn_desc = build_connections_test_database(reverse=True)
        try:
            p_asc = generate_connections_puzzle(conn_asc, seed="invariance-seed")
            p_desc = generate_connections_puzzle(conn_desc, seed="invariance-seed")
            self.assertEqual(p_asc["puzzle_id"], p_desc["puzzle_id"])
            self.assertEqual(p_asc, p_desc)
        finally:
            conn_asc.close()
            conn_desc.close()

    def test_insufficient_groups_error(self):
        """Verify ValueError when database has fewer than 16 groups."""
        empty_conn = sqlite3.connect(":memory:")
        empty_conn.executescript(
            """
            CREATE TABLE entities (id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT);
            CREATE TABLE entity_aliases (entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts (id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER, predicate TEXT, property_id TEXT, rank TEXT, value_wikidata_id TEXT, value_entity_id INTEGER, value_time TEXT, value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER, valid_to TEXT, valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT, status TEXT, status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT);
            CREATE TABLE wikidata_entity_snapshots (id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_pages (id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER);
            CREATE TABLE source_revisions (id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE fact_evidence (fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT, reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
            """
        )
        try:
            with self.assertRaises(ValueError) as ctx:
                generate_connections_puzzle(empty_conn, seed="test-seed")
            self.assertIn("Insufficient candidate groups", str(ctx.exception))
        finally:
            empty_conn.close()

    def test_member_counts_need_every_member_statement_loaded(self) -> None:
        """Verify groups with incomplete member statements do not generate member count criteria."""
        # One of Q101's four members is rejected. Counting the remaining three would
        # falsely place Q101 under '3 members'.
        self.conn.execute(
            "UPDATE facts SET status='rejected', status_reason='missing_evidence' "
            "WHERE statement_id=(SELECT MIN(statement_id) FROM facts WHERE statement_id LIKE 'has-101-%')"
        )
        entities = _load_entities(self.conn)
        facts, _rejected = _load_facts(self.conn, entities)
        complete = _groups_with_complete_members(self.conn, facts)
        self.assertNotIn("Q101", complete)
        self.assertIn("Q102", complete)

        candidates = {
            e.wikidata_id: e for e in entities.values() if e.entity_type == "group"
        }
        group_criteria, _evidence, _criteria = evaluate_connections_criteria(
            facts, candidates, complete
        )
        self.assertFalse(any(c.startswith("members_") for c in group_criteria["Q101"]))
        self.assertIn("members_5", group_criteria["Q102"])

        # Puzzle generation with Q101 incomplete
        puzzle = generate_connections_puzzle(self.conn, seed="connections-test-seed-1")
        validate_connections_puzzle(puzzle)
        for cat in puzzle["categories"]:
            if cat["id"].startswith("members_"):
                self.assertNotIn("Q101", cat["item_ids"])

    def test_member_counts_conflict_statement_excludes_group(self) -> None:
        """Verify groups with a conflicting member statement are excluded from member count criteria."""
        self.conn.execute(
            "UPDATE facts SET status='conflict', status_reason='competing_claim' "
            "WHERE statement_id=(SELECT MIN(statement_id) FROM facts WHERE statement_id LIKE 'has-101-%')"
        )
        entities = _load_entities(self.conn)
        facts, _rejected = _load_facts(self.conn, entities)
        complete = _groups_with_complete_members(self.conn, facts)
        self.assertNotIn("Q101", complete)

        candidates = {
            e.wikidata_id: e for e in entities.values() if e.entity_type == "group"
        }
        group_criteria, _evidence, _criteria = evaluate_connections_criteria(
            facts, candidates, complete
        )
        self.assertFalse(any(c.startswith("members_") for c in group_criteria["Q101"]))

    def test_member_counts_superseded_or_stale_statements_do_not_invalidate_group(self) -> None:
        """Verify superseded or stale member statements do not make a group appear incomplete."""
        # Insert superseded and stale statements representing former members or outdated claims.
        self.conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, status, quality_flags_json
            ) VALUES
            ('has-101-superseded', (SELECT id FROM entities WHERE wikidata_id='Q101'),
             'has_member', 'P527', 'deprecated', 'Q9999', 'superseded', '[]'),
            ('has-101-stale', (SELECT id FROM entities WHERE wikidata_id='Q101'),
             'has_member', 'P527', 'normal', 'Q9998', 'stale', '[]')
            """
        )
        entities = _load_entities(self.conn)
        facts, _rejected = _load_facts(self.conn, entities)
        complete = _groups_with_complete_members(self.conn, facts)
        self.assertIn("Q101", complete)

        candidates = {
            e.wikidata_id: e for e in entities.values() if e.entity_type == "group"
        }
        group_criteria, _evidence, _criteria = evaluate_connections_criteria(
            facts, candidates, complete
        )
        self.assertIn("members_4", group_criteria["Q101"])



class SearchCostTest(unittest.TestCase):
    """The search costs what it draws, whatever the size of the criteria."""

    def test_criterion_with_300_groups_is_cheap(self):
        # Criteria of 4, 5, 6 and 300 disjoint groups: the first board drawn is
        # the answer. The code that listed every quad of a level before the
        # first check took 15.1 s and 332 MiB (tracemalloc peak) for one check
        # at 100 groups, and stopped with MemoryError under a 2 GiB cap at 300
        # (C(285, 4) = 269 million quads), on a laptop with Python 3.14. The
        # lazy draws take about 1 ms and well under 1 MiB.
        groups = {
            "a": {f"A{index:03d}" for index in range(4)},
            "b": {f"B{index:03d}" for index in range(5)},
            "c": {f"C{index:03d}" for index in range(6)},
            "d": {f"D{index:03d}" for index in range(300)},
        }
        tracemalloc.start()
        try:
            tracemalloc.reset_peak()
            start = time.process_time()
            result = _find_disjoint_assignment(("a", "b", "c", "d"), groups, random.Random(b"300"))
            elapsed = time.process_time() - start
            _current, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertIsNotNone(result)
        self.assertLess(elapsed, 2.0)
        self.assertLess(peak, 100 * 2**20)

    def test_quads_of_every_level_are_charged(self):
        # Three criteria share the same 11 groups: after two quads, the third
        # level has 3 groups left, so no board is ever checked. The search
        # still pays for each quad it draws.
        shared = {f"Q{index:02d}" for index in range(11)}
        groups = {"a": shared, "b": shared, "c": shared, "d": shared | {"X1", "X2", "X3", "X4", "X5"}}
        budget = _SearchBudget(limit=50, seed="levels")
        with self.assertRaisesRegex(ValueError, r"used 50 of 50 steps \(0 criteria sets, 50 quads, 0 uniqueness checks\)"):
            _find_disjoint_assignment(("a", "b", "c", "d"), groups, random.Random(b"x"), budget=budget)

        budget = _SearchBudget(limit=10_000, seed="levels")
        result = _find_disjoint_assignment(
            ("a", "b", "c", "d"), groups, random.Random(b"x"), budget=budget, max_draws=400
        )
        self.assertIsNone(result)
        self.assertEqual(budget.spent["quads"], 400)

    def test_board_over_the_search_budget_is_refused(self):
        conn = build_connections_test_database()
        try:
            with self.assertRaisesRegex(
                ValueError,
                r"Connections search budget exhausted with seed 'budget-seed': used 3 of 3 steps",
            ):
                generate_connections_puzzle(conn, seed="budget-seed", max_search_steps=3)
        finally:
            conn.close()

    def test_same_board_in_processes_with_different_hash_seeds(self):
        """Set and dict order of strings changes with PYTHONHASHSEED; the board must not."""
        script = (
            "from tests.test_connections_generator import build_connections_test_database\n"
            "from kpop_scraping.connections_generator import generate_connections_puzzle\n"
            "conn = build_connections_test_database()\n"
            "print(generate_connections_puzzle(conn, seed='hash-seed-check')['puzzle_id'])\n"
        )
        root = Path(__file__).resolve().parent.parent
        ids = set()
        for hash_seed in ("0", "1", "4242"):
            env = {**os.environ, "PYTHONHASHSEED": hash_seed}
            completed = subprocess.run(
                [sys.executable, "-c", script], cwd=root, env=env,
                capture_output=True, text=True, timeout=120, check=True,
            )
            ids.add(completed.stdout.strip())
        conn = build_connections_test_database()
        try:
            ids.add(generate_connections_puzzle(conn, seed="hash-seed-check")["puzzle_id"])
        finally:
            conn.close()
        self.assertEqual(len(ids), 1)


class MemberCountCategoryUniquenessTest(unittest.TestCase):
    """An "N members" category needs every other item on the board ruled out of N.

    Playtest 2026-11-11: "3 integrantes" (Ablume, CNBLUE, LUV, 3YE) shared the
    board with BigBang and Super Junior-L.S.S., which fans know as trios.
    """

    # Every group outside "3 members" with an exact, complete count of 2, a
    # count no category uses: the board is fair and still generable.
    FAIR_MEMBERS = {
        qid: [ACCEPTED] * (3 if qid in PLAYTEST_2026_11_11_BOARD["members_3"][1] else 2)
        for qid in PLAYTEST_2026_11_11_NAMES
    }

    def generate(self, members: dict[str, list[str]]) -> dict:
        conn = build_playtest_board_database(members)
        try:
            return generate_connections_puzzle(conn, seed="kpop-connections-daily-2026-11-11")
        finally:
            conn.close()

    def test_playtest_board_of_2026_11_11_is_refused(self) -> None:
        conflicts = playtest_conflicts(PLAYTEST_2026_11_11_MEMBERS)
        self.assertIn(("members_3", "Q282104"), conflicts)  # BigBang, 3 to 5
        self.assertIn(("members_3", "Q120998562"), conflicts)  # L.S.S., 0 to 3
        # AKMU (1 to 2) and Winner (4 to 5) are ruled out by the data.
        self.assertNotIn(("members_3", "Q10728972"), conflicts)
        self.assertNotIn(("members_3", "Q15116397"), conflicts)
        with self.assertRaisesRegex(ValueError, "Unable to generate a solvable connections puzzle"):
            self.generate(PLAYTEST_2026_11_11_MEMBERS)

    def test_fair_board_is_generated(self) -> None:
        self.assertEqual(playtest_conflicts(self.FAIR_MEMBERS), set())
        puzzle = self.generate(self.FAIR_MEMBERS)
        categories = {cat["id"]: cat["item_ids"] for cat in puzzle["categories"]}
        self.assertEqual(categories["members_3"], sorted(PLAYTEST_2026_11_11_BOARD["members_3"][1]))

    def test_proven_equal_count_outside_the_category_is_refused(self) -> None:
        members = {**self.FAIR_MEMBERS, "Q282104": [ACCEPTED] * 3}
        self.assertEqual(playtest_conflicts(members), {("members_3", "Q282104")})
        with self.assertRaises(ValueError):
            self.generate(members)

    def test_unknown_count_that_may_be_n_is_refused(self) -> None:
        members = {**self.FAIR_MEMBERS, "Q120998562": [CONFLICT] * 3}
        self.assertEqual(playtest_conflicts(members), {("members_3", "Q120998562")})
        with self.assertRaises(ValueError):
            self.generate(members)

    def test_unknown_count_that_rules_n_out_is_accepted(self) -> None:
        # Four members loaded and one in conflict: 4 or 5, never 3.
        members = {**self.FAIR_MEMBERS, "Q282104": [ACCEPTED] * 4 + [CONFLICT]}
        self.assertEqual(playtest_conflicts(members), set())
        self.generate(members)

    def test_group_without_member_statements_is_refused(self) -> None:
        """Decision: no member data proves nothing, so the group could have N."""
        members = {**self.FAIR_MEMBERS, "Q239693": []}
        self.assertEqual(playtest_conflicts(members), {("members_3", "Q239693")})
        with self.assertRaises(ValueError):
            self.generate(members)

    def test_only_member_count_categories_are_checked(self) -> None:
        criteria = {c["id"]: c for c in MEMBER_COUNT_CRITERIA.values()}
        criteria["label_yg"] = {"id": "label_yg", "category": "record_label"}
        assignment = {"label_yg": ("A", "B", "C", "D"), "members_3": ("E", "F", "G", "H")}
        bounds = {qid: (3, 3) for qid in "ABCDEFGH"}
        self.assertEqual(
            member_count_conflicts(assignment, bounds, criteria),
            [("members_3", qid) for qid in "ABCD"],
        )
        # An item missing from the bounds is unknown, so it may have 3 members.
        del bounds["A"]
        bounds.update({qid: (5, 5) for qid in "BCD"})
        self.assertEqual(member_count_conflicts(assignment, bounds, criteria), [("members_3", "A")])


if __name__ == '__main__':
    unittest.main()
