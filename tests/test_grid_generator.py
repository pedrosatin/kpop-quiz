"""Unit tests for intersection grid generator and CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.grid_cli import main as cli_main
from kpop_scraping.grid_generator import (
    MEMBER_COUNT_CRITERIA,
    _find_mixed_axis_grid,
    _is_valid_axis,
    evaluate_group_criteria,
    generate_intersection_grid,
    has_distinct_assignment,
)
from kpop_scraping.grid_schema import validate_intersection_grid
from kpop_scraping.quiz_repository import _load_entities, _load_facts


def build_grid_test_database(reverse: bool = False) -> sqlite3.Connection:
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
    ]
    entity_ids: dict[str, int] = {}
    for qid, etype, cname in labels:
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

    # 15 groups: Q101 to Q115
    years = {
        101: 2001, 102: 2003, 103: 2005, 104: 2007, 105: 2008,
        106: 2011, 107: 2013, 108: 2015, 109: 2017, 110: 2018,
        111: 2020, 112: 2021, 113: 2022, 114: 2023, 115: 2024,
    }
    group_labels = {
        101: "Q483238", 104: "Q483238", 106: "Q483238", 109: "Q483238", 111: "Q483238", 114: "Q483238",
        102: "Q483957", 105: "Q483957", 107: "Q483957", 110: "Q483957", 112: "Q483957", 115: "Q483957",
        103: "Q483471", 108: "Q483471", 113: "Q483471",
    }
    member_counts = {
        101: 4, 102: 5, 103: 7, 104: 4, 105: 5,
        106: 4, 107: 5, 108: 8, 109: 4, 110: 5,
        111: 4, 112: 5, 113: 7, 114: 9, 115: 4,
    }

    numbers = list(reversed(range(101, 116))) if reverse else list(range(101, 116))
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

    # Person entities and has_member facts
    base_person_offsets: dict[int, int] = {}
    curr_offset = 1
    for n in range(101, 116):
        base_person_offsets[n] = curr_offset
        curr_offset += member_counts[n]

    for num in numbers:
        count = member_counts[num]
        base_idx = base_person_offsets[num]
        for offset in range(count):
            person_idx = base_idx + offset
            pqid = f"Q{1000 + person_idx}"
            pname = f"Person {person_idx}"
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

    # Formed_on and record_label facts
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


class IntersectionGridGeneratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = build_grid_test_database()

    def tearDown(self) -> None:
        self.connection.close()

    def test_bipartite_matching_distinct_assignment(self) -> None:
        # 1. Solvable matching with distinct representatives
        solvable_options = [
            ["Q1", "Q2"],
            ["Q2", "Q3"],
            ["Q3", "Q4"],
            ["Q4", "Q5"],
            ["Q5", "Q6"],
            ["Q6", "Q7"],
            ["Q7", "Q8"],
            ["Q8", "Q9"],
            ["Q9", "Q10"],
        ]
        self.assertTrue(has_distinct_assignment(solvable_options))

        # 2. Too few cells (< 9)
        self.assertFalse(has_distinct_assignment(solvable_options[:8]))

        # 3. An empty cell
        empty_cell_options = list(solvable_options)
        empty_cell_options[0] = []
        self.assertFalse(has_distinct_assignment(empty_cell_options))

        # 4. Violates Hall's condition (fewer than 9 distinct entities available)
        insufficient_entities = [["Q1", "Q2"] for _ in range(9)]
        self.assertFalse(has_distinct_assignment(insufficient_entities))

    def test_evaluate_group_criteria_detects_categories_and_evidence(self) -> None:
        entities = _load_entities(self.connection)
        facts, _ = _load_facts(self.connection, entities)
        candidate_groups = {
            e.wikidata_id: e for e in entities.values() if e.entity_type == "group"
        }

        group_criteria, group_evidence, all_criteria = evaluate_group_criteria(
            facts, candidate_groups
        )

        # Q101 was formed in 2001 (2000s), JYP label, 4 members
        q101_crits = group_criteria["Q101"]
        self.assertIn("formed_2000s", q101_crits)
        self.assertIn("label_jyp", q101_crits)
        self.assertIn("members_4", q101_crits)
        self.assertIn("members_le_4", q101_crits)
        self.assertIn("members_le_5", q101_crits)
        self.assertNotIn("formed_2010s", q101_crits)

        # Q103 was formed in 2005 (2000s), YG label, 7 members
        q103_crits = group_criteria["Q103"]
        self.assertIn("formed_2000s", q103_crits)
        self.assertIn("label_yg", q103_crits)
        self.assertIn("members_7", q103_crits)
        self.assertIn("members_ge_7", q103_crits)
        self.assertIn("members_ge_6", q103_crits)

        # Evidence records attached
        q101_jyp_ev = group_evidence[("Q101", "label_jyp")]
        self.assertTrue(len(q101_jyp_ev) >= 1)
        self.assertEqual(q101_jyp_ev[0].locator, "claims/P264/label-101")

        q101_formed_ev = group_evidence[("Q101", "formed_2000s")]
        self.assertTrue(len(q101_formed_ev) >= 1)
        self.assertEqual(q101_formed_ev[0].locator, "claims/P571/formed-101")

    def test_deterministic_generation_strict(self) -> None:
        grid_1 = generate_intersection_grid(self.connection, seed="kpop-daily-2026-09-17")
        grid_2 = generate_intersection_grid(self.connection, seed="kpop-daily-2026-09-17")
        grid_3 = generate_intersection_grid(self.connection, seed="different-seed-456")

        self.assertEqual(grid_1, grid_2)
        self.assertEqual(grid_1["grid_id"], grid_2["grid_id"])
        self.assertNotEqual(grid_1["grid_id"], grid_3["grid_id"])

        with build_grid_test_database(reverse=True) as conn_rev:
            grid_rev = generate_intersection_grid(conn_rev, seed="kpop-daily-2026-09-17")
            self.assertEqual(grid_1["grid_id"], grid_rev["grid_id"])
            self.assertEqual(grid_1, grid_rev)
        conn_rev.close()

    def test_generated_grid_satisfies_solvability_and_uniqueness(self) -> None:
        grid = generate_intersection_grid(self.connection, seed="solvability-check-seed")

        cells = grid["cells"]
        self.assertEqual(len(cells), 9)

        # Every cell must contain at least one valid group
        cell_options: list[list[str]] = []
        for cell in cells:
            self.assertTrue(
                len(cell["valid_entity_ids"]) >= 1,
                f"Cell ({cell['row_index']}, {cell['col_index']}) has no valid groups",
            )
            self.assertTrue(
                len(cell["evidence"]) >= 1,
                f"Cell ({cell['row_index']}, {cell['col_index']}) has no evidence",
            )
            cell_options.append(cell["valid_entity_ids"])

        # SDR check holds for generated grid
        self.assertTrue(
            has_distinct_assignment(cell_options),
            "Generated grid lacks a distinct representative assignment across 9 cells",
        )

    def test_generated_grid_passes_official_schema_validation(self) -> None:
        grid = generate_intersection_grid(self.connection, seed="schema-test-seed")
        validate_intersection_grid(grid)

        # Inspect required root fields
        self.assertEqual(grid["dimensions"], {"rows": 3, "cols": 3})
        self.assertEqual(len(grid["row_criteria"]), 3)
        self.assertEqual(len(grid["col_criteria"]), 3)
        self.assertEqual(len(grid["candidate_pool"]), 15)

    def test_mixed_axis_fallback_generates_evidenced_unique_grid(self) -> None:
        # Simulate a dataset for which none of the curated category partitions
        # are available. The broader search must still use accepted criteria,
        # preserve all nine distinct answers, and pass the unchanged schema.
        with patch("kpop_scraping.grid_generator._build_axes_for_categories", return_value=[]):
            grid = generate_intersection_grid(
                self.connection, seed="mixed-axis-fallback-regression"
            )

        validate_intersection_grid(grid)
        self.assertEqual(grid["dimensions"], {"rows": 3, "cols": 3})
        self.assertTrue(
            has_distinct_assignment(
                [cell["valid_entity_ids"] for cell in grid["cells"]]
            )
        )
        self.assertTrue(all(cell["valid_entity_ids"] for cell in grid["cells"]))
        self.assertTrue(all(cell["evidence"] for cell in grid["cells"]))
        row_cats = {c["category"] for c in grid["row_criteria"]}
        col_cats = {c["category"] for c in grid["col_criteria"]}
        self.assertTrue(
            row_cats.isdisjoint(col_cats),
            f"Row categories {row_cats} and column categories {col_cats} must be disjoint",
        )
        for r in range(3):
            for c in range(3):
                self.assertNotEqual(
                    grid["row_criteria"][r]["category"],
                    grid["col_criteria"][c]["category"],
                    f"Cell ({r}, {c}) has identical row and column category",
                )

    def test_mixed_axis_search_does_not_stop_at_old_attempt_limit(self) -> None:
        criteria = [
            {
                "id": f"criterion_{index:02d}",
                "category": "formed_on" if index < 25 else "record_label",
                "label": {"pt-BR": f"Critério {index}", "en": f"Criterion {index}"},
            }
            for index in range(50)
        ]
        all_groups = {f"Q{index}" for index in range(1, 10)}
        criterion_groups = {criterion["id"]: all_groups for criterion in criteria}
        original_matching = has_distinct_assignment
        calls = 0

        def delay_acceptance(cell_options: list[list[str]]) -> bool:
            nonlocal calls
            calls += 1
            if calls <= 50_000:
                return False
            return original_matching(cell_options)

        with patch(
            "kpop_scraping.grid_generator.has_distinct_assignment",
            side_effect=delay_acceptance,
        ):
            result = _find_mixed_axis_grid(
                criteria, criterion_groups, seed="solution-after-old-limit"
            )

        self.assertIsNotNone(result)
        self.assertGreater(calls, 50_000)
        assert result is not None
        self.assertTrue(
            original_matching(
                [result[2][(row, col)] for row in range(3) for col in range(3)]
            )
        )

    def test_mixed_axis_search_prunes_when_fewer_than_nine_answers_exist(self) -> None:
        criteria = [
            {
                "id": f"criterion_{index:02d}",
                "category": "formed_on" if index < 15 else "record_label",
                "label": {"pt-BR": f"Critério {index}", "en": f"Criterion {index}"},
            }
            for index in range(29)
        ]
        only_eight_groups = {f"Q{index}" for index in range(1, 9)}
        criterion_groups = {
            criterion["id"]: only_eight_groups for criterion in criteria
        }

        with patch(
            "kpop_scraping.grid_generator.has_distinct_assignment",
            side_effect=AssertionError("matching should be pruned before column triples"),
        ):
            result = _find_mixed_axis_grid(
                criteria, criterion_groups, seed="eight-groups-impossible"
            )

        self.assertIsNone(result)

    def test_is_valid_axis(self) -> None:
        axis_overlapping_4 = (
            MEMBER_COUNT_CRITERIA["members_le_4"],
            MEMBER_COUNT_CRITERIA["members_4"],
            {"id": "formed_2010s", "category": "formed_on"},
        )
        self.assertFalse(_is_valid_axis(axis_overlapping_4))

        axis_overlapping_3 = (
            MEMBER_COUNT_CRITERIA["members_le_4"],
            MEMBER_COUNT_CRITERIA["members_3"],
            {"id": "label_sm", "category": "record_label"},
        )
        self.assertFalse(_is_valid_axis(axis_overlapping_3))

        axis_disjoint = (
            MEMBER_COUNT_CRITERIA["members_3"],
            MEMBER_COUNT_CRITERIA["members_4"],
            MEMBER_COUNT_CRITERIA["members_5"],
        )
        self.assertTrue(_is_valid_axis(axis_disjoint))

        axis_mixed = (
            {"id": "label_sm", "category": "record_label"},
            {"id": "formed_2010s", "category": "formed_on"},
            MEMBER_COUNT_CRITERIA["members_4"],
        )
        self.assertTrue(_is_valid_axis(axis_mixed))

        axis_duplicate = (
            {"id": "label_sm", "category": "record_label"},
            {"id": "label_sm", "category": "record_label"},
            {"id": "formed_2010s", "category": "formed_on"},
        )
        self.assertFalse(_is_valid_axis(axis_duplicate))

    def test_mixed_axis_search_rejects_overlapping_member_criteria(self) -> None:
        criteria = [
            {"id": "label_a", "category": "record_label", "label": {"pt-BR": "A", "en": "A"}},
            {"id": "label_b", "category": "record_label", "label": {"pt-BR": "B", "en": "B"}},
            {"id": "label_c", "category": "record_label", "label": {"pt-BR": "C", "en": "C"}},
            MEMBER_COUNT_CRITERIA["members_le_4"],
            MEMBER_COUNT_CRITERIA["members_4"],
            MEMBER_COUNT_CRITERIA["members_3"],
        ]
        all_groups = {f"Q{index}" for index in range(1, 10)}
        criterion_groups = {criterion["id"]: all_groups for criterion in criteria}

        result = _find_mixed_axis_grid(
            criteria, criterion_groups, seed="conflict-overlapping-members"
        )
        self.assertIsNone(result)

    def test_insufficient_groups_raises_error(self) -> None:
        small_conn = sqlite3.connect(":memory:")
        small_conn.row_factory = sqlite3.Row
        small_conn.executescript(
            """
            CREATE TABLE entities (id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT);
            CREATE TABLE entity_aliases (entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts (
                id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER, predicate TEXT,
                property_id TEXT, rank TEXT, value_wikidata_id TEXT, value_entity_id INTEGER, value_time TEXT,
                value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER, valid_to TEXT,
                valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT, status TEXT,
                status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT
            );
            CREATE TABLE wikidata_entity_snapshots (id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_pages (id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER);
            CREATE TABLE source_revisions (id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE fact_evidence (fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT, reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
            """
        )
        for i in range(1, 5):
            small_conn.execute(
                "INSERT INTO entities VALUES (?, ?, 'group', ?)",
                (i, f"Q{i}", f"Group {i}"),
            )
        small_conn.commit()

        with self.assertRaises(ValueError) as ctx:
            generate_intersection_grid(small_conn, seed="too-small")
        self.assertIn("Insufficient candidate groups", str(ctx.exception))
        small_conn.close()


class IntersectionGridCLITest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmpdir.name)
        self.db_path = self.tmp_path / "test.db"

        # Backup memory database to disk file for CLI tests
        mem_conn = build_grid_test_database()
        file_conn = sqlite3.connect(str(self.db_path))
        mem_conn.backup(file_conn)
        file_conn.close()
        mem_conn.close()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_cli_missing_database_returns_error(self) -> None:
        missing_db = self.tmp_path / "nonexistent.db"
        exit_code = cli_main(["--database", str(missing_db)])
        self.assertEqual(exit_code, 1)

    def test_cli_generates_atomic_output_with_seed(self) -> None:
        output_file = self.tmp_path / "grid_output.json"
        exit_code = cli_main([
            "--database", str(self.db_path),
            "--output", str(output_file),
            "--seed", "test-cli-seed-01",
        ])
        self.assertEqual(exit_code, 0)
        self.assertTrue(output_file.exists())

        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        validate_intersection_grid(data)
        self.assertEqual(data["dimensions"], {"rows": 3, "cols": 3})

    def test_cli_generates_daily_puzzle_with_date(self) -> None:
        output_file = self.tmp_path / "daily_grid.json"
        exit_code = cli_main([
            "--database", str(self.db_path),
            "--output", str(output_file),
            "--date", "2026-09-17",
        ])
        self.assertEqual(exit_code, 0)
        self.assertTrue(output_file.exists())

        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["reference_date"], "2026-09-17")
        validate_intersection_grid(data)

    def test_cli_outputs_to_stdout_when_output_omitted(self) -> None:
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            exit_code = cli_main([
                "--database", str(self.db_path),
                "--seed", "stdout-seed",
            ])
        self.assertEqual(exit_code, 0)
        output_text = stdout_capture.getvalue()
        self.assertTrue(len(output_text) > 0)
        data = json.loads(output_text)
        validate_intersection_grid(data)


if __name__ == "__main__":
    unittest.main()
