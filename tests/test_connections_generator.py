"""Unit tests for connections puzzle generator, partition uniqueness solver, and CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.connections_cli import main as cli_main
from kpop_scraping.connections_generator import (
    count_valid_partitions,
    generate_connections_puzzle,
)
from kpop_scraping.connections_schema import validate_connections_puzzle


def build_connections_test_database(reverse: bool = False) -> sqlite3.Connection:
    """Create an in-memory SQLite database populated with test entities, facts, and evidence."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
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
    )
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


class ConnectionsCliTest(unittest.TestCase):
    """Unit tests for connections CLI."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"

        # Create physical SQLite database on disk
        mem_conn = build_connections_test_database()
        disk_conn = sqlite3.connect(str(self.db_path))
        mem_conn.backup(disk_conn)
        disk_conn.close()
        mem_conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_stdout_output(self):
        """Verify CLI outputs valid JSON to stdout when --output is omitted."""
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(["--database", str(self.db_path), "--seed", "cli-test-seed"])
        self.assertEqual(ret, 0)

        output_str = stdout_buf.getvalue()
        puzzle = json.loads(output_str)
        validate_connections_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-connections-puzzle-v1")

    def test_cli_file_output(self):
        """Verify CLI writes atomic file when --output is provided."""
        out_path = Path(self.temp_dir.name) / "puzzle_out.json"
        ret = cli_main([
            "--database", str(self.db_path),
            "--output", str(out_path),
            "--seed", "cli-test-seed",
        ])
        self.assertEqual(ret, 0)
        self.assertTrue(out_path.is_file())

        with open(out_path, "r", encoding="utf-8") as f:
            puzzle = json.load(f)
        validate_connections_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-connections-puzzle-v1")

    def test_cli_missing_database(self):
        """Verify CLI returns 1 and prints error when database file is missing."""
        missing_db = Path(self.temp_dir.name) / "nonexistent.db"
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            ret = cli_main(["--database", str(missing_db)])
        self.assertEqual(ret, 1)
        self.assertIn("Database does not exist", stderr_buf.getvalue())

    def test_cli_date_option(self):
        """Verify CLI accepts --date and derives reference_date."""
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-17",
            ])
        self.assertEqual(ret, 0)
        puzzle = json.loads(stdout_buf.getvalue())
        self.assertEqual(puzzle["reference_date"], "2026-09-17")

    def test_cli_seed_and_date_options(self):
        """Verify CLI prioritizes --seed over --date derived seed."""
        stdout_buf1 = io.StringIO()
        with patch("sys.stdout", stdout_buf1):
            cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-17",
                "--seed", "custom-seed-123",
            ])
        p1 = json.loads(stdout_buf1.getvalue())

        stdout_buf2 = io.StringIO()
        with patch("sys.stdout", stdout_buf2):
            cli_main([
                "--database", str(self.db_path),
                "--date", "2026-09-18",
                "--seed", "custom-seed-123",
            ])
        p2 = json.loads(stdout_buf2.getvalue())

        # Since seed is the same, category selection matches
        self.assertEqual(
            [c["id"] for c in p1["categories"]],
            [c["id"] for c in p2["categories"]],
        )
        self.assertNotEqual(p1["reference_date"], p2["reference_date"])


if __name__ == "__main__":
    unittest.main()
