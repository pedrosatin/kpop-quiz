"""Unit tests for intersection grid generator and CLI."""

from __future__ import annotations

import io
import itertools
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
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.grid_cli import main as cli_main
from kpop_scraping.grid_generator import (
    _groups_with_complete_members,
    CATEGORY_PARTITIONS,
    DECADE_CRITERIA,
    MAX_AXIS_SEARCH_STEPS,
    MEMBER_COUNT_CRITERIA,
    _AxisSearchBudget,
    _criteria_set,
    _curated_pair_blocks,
    _find_mixed_axis_grid,
    _is_valid_axis,
    _select_axes,
    evaluate_group_criteria,
    generate_intersection_grid,
    generate_daily_grid,
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

    def test_daily_grid_defaults_to_the_publishers_reference_date(self) -> None:
        with patch("kpop_scraping.grid_generator.reference_date_today", return_value="2026-09-29"):
            grid = generate_daily_grid(self.connection)
        expected = generate_intersection_grid(
            self.connection, seed="kpop-grid-daily-2026-09-29", reference_date=date(2026, 9, 29)
        )
        self.assertEqual(grid, expected)

    def test_missing_cross_category_coverage_reports_sourced_group_counts(self) -> None:
        self.connection.execute("UPDATE facts SET status='rejected' WHERE predicate IN ('record_label', 'has_member')")
        with self.assertRaisesRegex(ValueError, "evidence-backed group coverage") as error:
            generate_intersection_grid(self.connection, seed="missing-coverage")
        self.assertIn("'record_label': 0", str(error.exception))
        self.assertIn("'has_member': 0", str(error.exception))

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
        # One other seed may land on the same grid in a small fixture, so
        # the seed's effect is checked across several seeds.
        other_ids = {
            generate_intersection_grid(self.connection, seed=f"different-seed-{index}")["grid_id"]
            for index in range(6)
        }

        self.assertEqual(grid_1, grid_2)
        self.assertEqual(grid_1["grid_id"], grid_2["grid_id"])
        self.assertTrue(other_ids - {grid_1["grid_id"]})

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

    def test_wikipedia_notes_in_labels_stay_published_and_do_not_move_the_grid(self) -> None:
        """Labels reach the artifact as collected; the page decides what to hide.

        Stripping a note in the generator would change grid_id and could drop a
        note two homonyms need. Only label text may differ between the runs.
        """
        baseline = generate_intersection_grid(self.connection, seed="labels-seed")
        self.connection.execute(
            "UPDATE entity_aliases SET name='Tempest (grupo)' WHERE language='pt' AND name='Test Group 101'"
        )
        self.connection.execute(
            "UPDATE entity_aliases SET name='Tempest (banda)' WHERE language='pt' AND name='Test Group 102'"
        )
        renamed = generate_intersection_grid(self.connection, seed="labels-seed")

        pool = {item["id"]: item for item in renamed["candidate_pool"]}
        self.assertEqual(pool["Q101"]["names"]["pt-BR"], "Tempest (grupo)")
        self.assertEqual(pool["Q102"]["names"]["pt-BR"], "Tempest (banda)")
        self.assertEqual(pool["Q101"]["canonical_name"], "Test Group 101")
        self.assertEqual(renamed["cells"], baseline["cells"])
        self.assertEqual(renamed["row_criteria"], baseline["row_criteria"])
        self.assertEqual(renamed["col_criteria"], baseline["col_criteria"])
        self.assertEqual(
            [item["id"] for item in renamed["candidate_pool"]],
            [item["id"] for item in baseline["candidate_pool"]],
        )
        validate_intersection_grid(renamed)

    def test_candidates_carry_the_other_names_of_the_group_for_search(self) -> None:
        """Alternative labels from the entity snapshot reach the picker.

        Names already shown (canonical and per-language) are not repeated, and
        the list is sorted so equal databases yield equal bytes.
        """
        group_id = self.connection.execute(
            "SELECT id FROM entities WHERE wikidata_id='Q101'"
        ).fetchone()["id"]
        self.connection.executemany(
            "INSERT INTO entity_aliases VALUES (?, ?, ?, ?)",
            [
                (group_id, "en", "TG101", "alias"),
                (group_id, "ko", "테스트그룹", "label"),
                (group_id, "en", "Test Group 101", "alias"),
                (group_id, "ko", " TG101 ", "alias"),
            ],
        )
        grid = generate_intersection_grid(self.connection, seed="alias-seed")
        pool = {item["id"]: item for item in grid["candidate_pool"]}

        self.assertEqual(pool["Q101"]["aliases"], ["TG101", "테스트그룹"])
        self.assertEqual(pool["Q102"]["aliases"], [])
        validate_intersection_grid(grid)

    def test_mixed_axis_fallback_generates_evidenced_unique_grid(self) -> None:
        # Simulate a dataset for which none of the curated category partitions
        # are available. The broader search must still use accepted criteria,
        # preserve all nine distinct answers, and pass the unchanged schema.
        with patch("kpop_scraping.grid_generator._curated_pair_blocks", return_value=[]):
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

    def test_mixed_axis_search_finds_a_late_solution_within_the_budget(self) -> None:
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
        delayed = MAX_AXIS_SEARCH_STEPS // 2

        def delay_acceptance(cell_options: list[list[str]]) -> bool:
            nonlocal calls
            calls += 1
            if calls <= delayed:
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
        self.assertGreater(calls, delayed)
        assert result is not None
        self.assertTrue(
            original_matching(
                [result[2][(row, col)] for row in range(3) for col in range(3)]
            )
        )

    def test_mixed_axis_search_stops_at_its_budget(self) -> None:
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
        budget = _AxisSearchBudget(limit=500, seed="never-solvable")

        with patch("kpop_scraping.grid_generator.has_distinct_assignment", return_value=False):
            with self.assertRaisesRegex(
                ValueError,
                r"Grid axis search budget exhausted with seed 'never-solvable': "
                r"used 500 of 500 steps \(0 axis pairs, \d+ row axes, \d+ column triples\)",
            ):
                _find_mixed_axis_grid(
                    criteria, criterion_groups, seed="never-solvable", budget=budget
                )
        self.assertGreater(budget.spent["row axes"], 0)
        self.assertGreater(budget.spent["column triples"], 0)

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

    def test_member_counts_need_every_member_statement_loaded(self) -> None:
        # One of Q101's four members is rejected: counting the other three
        # would place Q101 under "3 members".
        self.connection.execute(
            "UPDATE facts SET status='rejected', status_reason='missing_evidence' "
            "WHERE statement_id=(SELECT MIN(statement_id) FROM facts WHERE statement_id LIKE 'has-101-%')"
        )
        entities = _load_entities(self.connection)
        facts, _rejected = _load_facts(self.connection, entities)
        complete = _groups_with_complete_members(self.connection, facts)
        self.assertNotIn("Q101", complete)
        self.assertIn("Q102", complete)

        candidates = {e.wikidata_id: e for e in entities.values() if e.entity_type == "group"}
        group_criteria, _evidence, _criteria = evaluate_group_criteria(facts, candidates, complete)
        self.assertFalse(any(c.startswith("members_") for c in group_criteria["Q101"]))
        self.assertIn("members_5", group_criteria["Q102"])

        grid = generate_intersection_grid(self.connection, seed="kpop-daily-2026-09-17")
        for cell in grid["cells"]:
            criteria = {
                grid["row_criteria"][cell["row_index"]]["category"],
                grid["col_criteria"][cell["col_index"]]["category"],
            }
            if "has_member" in criteria:
                self.assertNotIn("Q101", cell["valid_entity_ids"])

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


def add_cube_groups(conn: sqlite3.Connection) -> None:
    """Add Cube Entertainment groups formed in each decade of the base fixture.

    The base fixture has one solvable set of six criteria, three labels by
    three decades. A fourth label makes four, few enough for the seed alone
    to draw the same set on consecutive days.
    """
    label_id = conn.execute(
        "INSERT INTO entities(wikidata_id, entity_type, canonical_name) "
        "VALUES ('Q483327', 'organization', 'Cube Entertainment')"
    ).lastrowid
    for language in ("en", "pt"):
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, ?, 'Cube Entertainment', 'label')",
            (label_id, language),
        )
    for num, year in ((120, 2006), (121, 2016), (122, 2025)):
        name = f"Test Group {num}"
        group_id = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'group', ?)",
            (f"Q{num}", name),
        ).lastrowid
        for language in ("en", "pt"):
            conn.execute(
                "INSERT INTO entity_aliases VALUES (?, ?, ?, 'label')", (group_id, language, name)
            )
        facts = (
            (f"formed-{num}", "formed_on", "P571", None, None, str(year), 9),
            (f"label-{num}", "record_label", "P264", "Q483327", label_id, None, None),
        )
        for statement, predicate, prop, value_qid, value_id, value_time, precision in facts:
            fact_id = conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    value_wikidata_id, value_entity_id, value_time, value_precision,
                    status, quality_flags_json
                ) VALUES (?, ?, ?, ?, 'normal', ?, ?, ?, ?, 'accepted', '[]')
                """,
                (statement, group_id, predicate, prop, value_qid, value_id, value_time, precision),
            ).lastrowid
            conn.execute(
                """
                INSERT INTO fact_evidence(
                    fact_id, evidence_type, source_key, locator, reference_hash,
                    wikidata_snapshot_id
                ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'refhash', 1)
                """,
                (fact_id, f"claims/{prop}/{statement}"),
            )
    conn.commit()


def criteria_set(grid: dict) -> frozenset[str]:
    return frozenset(c["id"] for c in grid["row_criteria"] + grid["col_criteria"])


class ConsecutiveDailyGridTest(unittest.TestCase):
    """Consecutive dates never publish the same six criteria (ticket 10)."""

    DAYS = [date(2026, 11, 1) + timedelta(days=offset) for offset in range(14)]

    def setUp(self) -> None:
        self.connection = build_grid_test_database()
        add_cube_groups(self.connection)

    def tearDown(self) -> None:
        self.connection.close()

    def seed_draw(self, day: date) -> dict:
        return generate_intersection_grid(
            self.connection, seed=f"kpop-grid-daily-{day.isoformat()}", reference_date=day
        )

    def test_seed_draw_alone_repeats_criteria_in_this_window(self) -> None:
        # Without the neighbour rule, 08/11 and 11/11 draw the criteria of the
        # day before, so this window exercises the regression.
        drawn = [criteria_set(self.seed_draw(day)) for day in self.DAYS]
        repeated = [day for day, before, after in zip(self.DAYS[1:], drawn, drawn[1:]) if before == after]
        self.assertEqual(repeated, [date(2026, 11, 8), date(2026, 11, 11)])

    def test_consecutive_days_never_share_the_six_criteria(self) -> None:
        published = [criteria_set(generate_daily_grid(self.connection, day)) for day in self.DAYS]
        for day, before, after in zip(self.DAYS[1:], published, published[1:]):
            self.assertNotEqual(before, after, f"{day} repeats the criteria of the day before")
        self.assertEqual(len(set(published)), 4)

    def test_even_days_keep_the_grid_their_seed_draws(self) -> None:
        for day in self.DAYS:
            if day.toordinal() % 2 == 0:
                self.assertEqual(generate_daily_grid(self.connection, day), self.seed_draw(day))

    def test_odd_day_skips_both_neighbours_deterministically(self) -> None:
        day = date(2026, 11, 11)
        first = generate_daily_grid(self.connection, day)
        self.assertEqual(first, generate_daily_grid(self.connection, day.isoformat()))
        self.assertNotIn(
            criteria_set(first),
            {criteria_set(self.seed_draw(day - timedelta(days=1))),
             criteria_set(self.seed_draw(day + timedelta(days=1)))},
        )
        validate_intersection_grid(first)

    def test_explicit_seed_keeps_the_plain_draw(self) -> None:
        day = date(2026, 11, 11)
        self.assertEqual(
            generate_daily_grid(self.connection, day, seed=f"kpop-grid-daily-{day.isoformat()}"),
            self.seed_draw(day),
        )

    def test_odd_day_without_another_solvable_grid_raises(self) -> None:
        # The base fixture has a single solvable set: even days still publish
        # it, odd days fail so the publisher's fallback decides the day.
        connection = build_grid_test_database()
        try:
            generate_daily_grid(connection, date(2026, 11, 4))
            with self.assertRaisesRegex(ValueError, "repeats the criteria of a neighbouring day"):
                generate_daily_grid(connection, date(2026, 11, 5))
        finally:
            connection.close()



def criterion(criterion_id: str, category: str) -> dict:
    return {
        "id": criterion_id,
        "category": category,
        "label": {"pt-BR": criterion_id, "en": criterion_id},
    }


def many_labels_catalog(layout: str, labels: int = 100) -> tuple[dict, dict]:
    """The 4 decades, the 12 member counts and ``labels`` record labels of 3 groups.

    ``apart``: the labels share 3 groups that no other criterion has, and each
    decade and member count has 5 groups of its own, so no grid exists.
    ``together``: every criterion has the same 3 groups, so every cell is
    filled and no grid has nine distinct answers.
    ``solvable``: label i has 3 groups of its own, spread over the decades and
    member counts.
    """
    all_criteria = {**DECADE_CRITERIA, **MEMBER_COUNT_CRITERIA}
    label_ids = [f"label_q{index:04d}" for index in range(labels)]
    for label_id in label_ids:
        all_criteria[label_id] = criterion(label_id, "record_label")
    fixed_ids = [*DECADE_CRITERIA, *MEMBER_COUNT_CRITERIA]
    groups: dict[str, set[str]] = defaultdict(set)
    if layout == "apart":
        for label_id in label_ids:
            groups[label_id] = {"QS1", "QS2", "QS3"}
        for index, criterion_id in enumerate(fixed_ids):
            groups[criterion_id] = {f"QF{index}_{member}" for member in range(5)}
    elif layout == "together":
        for criterion_id in all_criteria:
            groups[criterion_id] = {"QS1", "QS2", "QS3"}
    else:
        decades, members = list(DECADE_CRITERIA), list(MEMBER_COUNT_CRITERIA)
        for index, label_id in enumerate(label_ids):
            for offset in range(3):
                group = f"QL{index}_{offset}"
                groups[label_id].add(group)
                groups[decades[(index + offset) % len(decades)]].add(group)
                groups[members[(index + offset) % len(members)]].add(group)
    return all_criteria, groups


def measure(call):
    """Return (result or ValueError, CPU seconds, tracemalloc peak) of ``call``.

    Tracing every allocation makes the search several times slower, so the
    time comes from a run without tracing and the peak from a second run.
    """
    def run():
        try:
            return call()
        except ValueError as exc:
            return exc

    start = time.process_time()
    outcome = run()
    elapsed = time.process_time() - start
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        run()
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return outcome, elapsed, peak


def listed_axes(active_by_cat: dict, spec: tuple[str, ...]) -> list[tuple]:
    """Every valid axis of a category spec, listed as the generator once listed them."""
    if len(spec) == 1:
        combos = itertools.combinations(active_by_cat.get(spec[0], []), 3)
    else:
        combos = (
            (*pair, item)
            for pair in itertools.combinations(active_by_cat.get(spec[0], []), 2)
            for item in active_by_cat.get(spec[1], [])
        )
    return [axis for axis in combos if _is_valid_axis(axis)]


class AxisSearchCostTest(unittest.TestCase):
    """The axis search costs what it draws, whatever the number of record labels."""

    def test_100_record_labels_end_quickly_in_little_memory(self) -> None:
        # 100 record labels of 3 groups and the 12 member counts. The code
        # that listed, sorted and shuffled every curated pair before testing
        # one stopped with MemoryError under a 2 GiB cap: after 65 s of CPU
        # for "apart" and 21 s for "together", on a laptop with Python 3.14.
        # Here the budget ends both in about 0.5 s, under 10 MiB.
        for layout in ("apart", "together"):
            with self.subTest(layout=layout):
                all_criteria, groups = many_labels_catalog(layout)
                outcome, elapsed, peak = measure(
                    lambda: _select_axes(all_criteria, groups, "many-labels")
                )
                self.assertIsInstance(outcome, ValueError)
                self.assertIn(
                    f"used {MAX_AXIS_SEARCH_STEPS} of {MAX_AXIS_SEARCH_STEPS} steps", str(outcome)
                )
                self.assertLess(elapsed, 2.0)
                self.assertLess(peak, 64 * 2**20)

    def test_100_record_labels_with_a_grid_find_it_at_once(self) -> None:
        all_criteria, groups = many_labels_catalog("solvable")
        outcome, elapsed, peak = measure(
            lambda: _select_axes(all_criteria, groups, "many-labels")
        )
        self.assertIsInstance(outcome, tuple)
        row_axis, col_axis, cells = outcome
        self.assertTrue(has_distinct_assignment([cells[(r, c)] for r in range(3) for c in range(3)]))
        self.assertLess(elapsed, 2.0)
        self.assertLess(peak, 64 * 2**20)

    def test_blocks_hold_each_pair_with_nine_filled_cells_once(self) -> None:
        # Against the listing the generator used before: every curated pair
        # whose nine cells all have a group, each exactly once.
        rng = random.Random(b"catalog")
        decades = list(DECADE_CRITERIA)
        members = ["members_3", "members_4", "members_le_4", "members_le_5", "members_ge_6", "members_ge_8"]
        labels = [f"label_q{index}" for index in range(9)]
        all_criteria = {**{key: DECADE_CRITERIA[key] for key in decades},
                        **{key: MEMBER_COUNT_CRITERIA[key] for key in members},
                        **{key: criterion(key, "record_label") for key in labels}}
        groups: dict[str, set[str]] = defaultdict(set)
        for index in range(60):
            group = f"Q{index}"
            groups[rng.choice(decades)].add(group)
            for member in rng.sample(members, rng.randint(0, 2)):
                groups[member].add(group)
            for label in rng.sample(labels, rng.randint(0, 3)):
                groups[label].add(group)
        active_by_cat: dict[str, list] = defaultdict(list)
        for item in sorted(all_criteria.values(), key=lambda c: (c["category"], c["id"])):
            active_by_cat[item["category"]].append(item)

        def ids(pair):
            return tuple(c["id"] for c in pair[0]), tuple(c["id"] for c in pair[1])

        listed = [
            ids((row, col))
            for row_spec, col_spec in CATEGORY_PARTITIONS
            for row in listed_axes(active_by_cat, row_spec)
            for col in listed_axes(active_by_cat, col_spec)
            if all(groups[r["id"]] & groups[c["id"]] for r in row for c in col)
        ]
        blocks = _curated_pair_blocks(active_by_cat, groups)
        drawn = [ids(block.pair(rank)) for block in blocks for rank in range(block.size)]
        self.assertGreater(len(listed), 100)
        self.assertEqual(len(drawn), len(set(drawn)))
        self.assertEqual(sorted(drawn), sorted(listed))

    def test_grid_over_the_search_budget_is_refused(self) -> None:
        connection = build_grid_test_database()
        try:
            with self.assertRaisesRegex(
                ValueError,
                r"Grid axis search budget exhausted with seed 'budget-seed': used 0 of 0 steps",
            ):
                generate_intersection_grid(connection, seed="budget-seed", max_search_steps=0)
        finally:
            connection.close()

    def test_skipping_neighbours_does_not_change_the_order(self) -> None:
        # A pair skipped for a neighbour still consumes its draw, so avoiding
        # a set that the seed never reaches chooses the same pair.
        all_criteria, groups = many_labels_catalog("solvable", labels=30)
        plain = _select_axes(all_criteria, groups, "order-seed")
        assert plain is not None
        unrelated = frozenset({frozenset({"formed_1990s", "never", "drawn"})})
        self.assertEqual(_select_axes(all_criteria, groups, "order-seed", unrelated), plain)
        skipped = _select_axes(
            all_criteria, groups, "order-seed", frozenset({_criteria_set(plain[0], plain[1])})
        )
        assert skipped is not None
        self.assertNotEqual(_criteria_set(skipped[0], skipped[1]), _criteria_set(plain[0], plain[1]))

    def test_same_grid_in_processes_with_different_hash_seeds(self) -> None:
        """Set and dict order of strings changes with PYTHONHASHSEED; the grid must not."""
        script = (
            "from datetime import date\n"
            "from tests.test_grid_generator import (\n"
            "    add_cube_groups, build_grid_test_database, many_labels_catalog)\n"
            "from kpop_scraping.grid_generator import _select_axes, generate_daily_grid\n"
            "conn = build_grid_test_database()\n"
            "add_cube_groups(conn)\n"
            "for day in (date(2026, 11, 10), date(2026, 11, 11)):\n"
            "    print(generate_daily_grid(conn, day)['grid_id'])\n"
            "row, col, _ = _select_axes(*many_labels_catalog('solvable'), 'hash-seed-check')\n"
            "print(','.join(c['id'] for c in row + col))\n"
        )
        root = Path(__file__).resolve().parent.parent
        outputs = set()
        for hash_seed in ("0", "1", "4242"):
            env = {**os.environ, "PYTHONHASHSEED": hash_seed}
            completed = subprocess.run(
                [sys.executable, "-c", script], cwd=root, env=env,
                capture_output=True, text=True, timeout=120, check=True,
            )
            outputs.add(completed.stdout)
        self.assertEqual(len(outputs), 1)
        self.assertEqual(len(outputs.pop().split()), 3)

if __name__ == "__main__":
    unittest.main()
