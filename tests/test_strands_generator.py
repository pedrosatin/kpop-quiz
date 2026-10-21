"""Unit tests for the deterministic Strands generator and CLI."""

from __future__ import annotations

import io
import json
import random
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import strands_generator
from kpop_scraping.quiz_repository import _load_entities, _load_facts
from kpop_scraping.strands_cli import main as cli_main
from kpop_scraping.strands_generator import (
    DISCARD_NON_LATIN_NAME,
    DISCARD_SHORT_NAME,
    AmbiguityLimitExceeded,
    StrandsGenerationError,
    UniquenessBudgetExceeded,
    assess_theme,
    build_strands_themes,
    classify_name,
    count_strands_solutions,
    enumerate_strands_solutions,
    find_word_paths,
    generate_strands_puzzle,
    place_strands_paths,
    spans_opposite_sides_idx,
    verify_strands_uniqueness,
)
from kpop_scraping.strands_schema import find_crossing, validate_strands_puzzle
from tests.test_word_search_generator import build_word_search_test_database

ROSTER_GROUP = ("Q990001000", "Starlight Orchard", 2016)
# STARLIGHTORCHARD (16) + these seven names (65) = 81 letters, a full 9x9 grid.
ROSTER_MEMBERS = [
    ("Q990001001", "Han Seoyeon"),
    ("Q990001002", "Baek Jiwoon"),
    ("Q990001003", "Moon Taeri"),
    ("Q990001004", "Choi Harin"),
    ("Q990001005", "Yoon Sejin"),
    ("Q990001006", "Kang Dohee"),
    ("Q990001007", "Seo Minjae"),
]
DISCARDED_MEMBERS = [
    ("Q990001008", "J.K"),
    ("Q990001009", "하늘"),
    ("Q990001010", "Mina 미나"),
]


def _insert_entity(conn: sqlite3.Connection, qid: str, entity_type: str, name: str) -> int:
    cur = conn.execute(
        "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
        (qid, entity_type, name),
    )
    for language in ("en", "pt"):
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, ?, ?, 'label')", (cur.lastrowid, language, name)
        )
    return int(cur.lastrowid)


def _insert_member(conn: sqlite3.Connection, group_id: int, person_qid: str, person_id: int) -> None:
    cur = conn.execute(
        """
        INSERT INTO facts(
            statement_id, subject_entity_id, predicate, property_id, rank,
            value_wikidata_id, value_entity_id, status, quality_flags_json
        ) VALUES (?, ?, 'has_member', 'P527', 'normal', ?, ?, 'accepted', '[]')
        """,
        (f"strands-member-{person_qid}", group_id, person_qid, person_id),
    )
    conn.execute(
        """
        INSERT INTO fact_evidence(
            fact_id, evidence_type, source_key, locator, reference_hash, wikidata_snapshot_id
        ) VALUES (?, 'wikidata_reference', 'wikidata', 'P527/hash1', 'ref1', 1)
        """,
        (cur.lastrowid,),
    )


def build_strands_test_database() -> sqlite3.Connection:
    """Word search fixture plus a fictional roster that fills a 9x9 grid."""
    conn = build_word_search_test_database()
    qid, name, _year = ROSTER_GROUP
    group_id = _insert_entity(conn, qid, "group", name)
    for person_qid, person_name in ROSTER_MEMBERS + DISCARDED_MEMBERS:
        person_id = _insert_entity(conn, person_qid, "person", person_name)
        _insert_member(conn, group_id, person_qid, person_id)
    conn.commit()
    return conn


def _themes(conn: sqlite3.Connection):
    entities = _load_entities(conn)
    facts, _rejected = _load_facts(conn, entities)
    return {theme.theme_id: theme for theme in build_strands_themes(entities, facts)}


ROSTER_THEME_ID = f"members_{ROSTER_GROUP[0].lower()}"


class TestNames(unittest.TestCase):
    def test_classify_name(self) -> None:
        self.assertEqual(classify_name("Han Seoyeon"), ("HANSEOYEON", None))
        self.assertEqual(classify_name("Rosé"), ("ROSE", None))
        self.assertEqual(classify_name("RM"), (None, DISCARD_SHORT_NAME))
        self.assertEqual(classify_name("I.N"), (None, DISCARD_SHORT_NAME))
        self.assertEqual(classify_name("하늘"), (None, DISCARD_NON_LATIN_NAME))
        self.assertEqual(classify_name("Mina 미나"), (None, DISCARD_NON_LATIN_NAME))


class TestThemes(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = build_strands_test_database()
        self.themes = _themes(self.conn)

    def tearDown(self) -> None:
        self.conn.close()

    def test_roster_theme_uses_group_as_entity_spangram(self) -> None:
        theme = self.themes[ROSTER_THEME_ID]
        self.assertEqual(theme.spangram_kind, "entity")
        self.assertEqual(theme.spangram.word, "STARLIGHTORCHARD")
        self.assertEqual(theme.spangram.entity_id, ROSTER_GROUP[0])
        self.assertTrue(theme.spangram.evidence)
        self.assertIn("atuais e antigos", theme.theme_description["pt-BR"])
        self.assertIn("current and former", theme.theme_description["en"])
        self.assertEqual(
            sorted(w.word for w in theme.words),
            sorted(classify_name(name)[0] for _qid, name in ROSTER_MEMBERS),
        )

    def test_discarded_names_carry_a_reason(self) -> None:
        theme = self.themes[ROSTER_THEME_ID]
        reasons = {d.entity_id: d.reason for d in theme.discarded}
        self.assertEqual(
            reasons,
            {
                "Q990001008": DISCARD_SHORT_NAME,
                "Q990001009": DISCARD_NON_LATIN_NAME,
                "Q990001010": DISCARD_NON_LATIN_NAME,
            },
        )

    def test_decade_theme_uses_theme_spangram(self) -> None:
        theme = self.themes["formed_2010s"]
        self.assertEqual(theme.spangram_kind, "theme")
        self.assertEqual(theme.spangram.word, "ANOSDOISMILEDEZ")
        self.assertIsNone(theme.spangram.entity_id)

    def test_record_label_themes_are_excluded(self) -> None:
        self.assertFalse(any(t.category == "record_label" for t in self.themes.values()))

    def test_feasibility_reasons(self) -> None:
        self.assertTrue(assess_theme(self.themes[ROSTER_THEME_ID], 9, 9).feasible)
        self.assertEqual(
            assess_theme(self.themes[ROSTER_THEME_ID], 10, 10).reason, "not_enough_letters"
        )
        twice = self.themes["members_q21480414"]
        self.assertEqual(assess_theme(twice, 9, 9).reason, "spangram_too_short")
        red_velvet = self.themes["members_q17425336"]
        self.assertEqual(assess_theme(red_velvet, 9, 9).reason, "not_enough_letters")


class TestUniqueness(unittest.TestCase):
    def test_counterexample_with_two_solutions(self) -> None:
        grid = [list("ABA"), list("BAB")]
        solutions = enumerate_strands_solutions(grid, ["ABA", "BAB"], limit=50)
        self.assertGreaterEqual(len(solutions), 2)
        self.assertEqual(len({tuple(s) for s in solutions}), len(solutions))
        self.assertEqual(count_strands_solutions(grid, ["ABA", "BAB"]), 2)

    def test_single_solution(self) -> None:
        grid = [list("ABC"), list("DEF")]
        self.assertEqual(count_strands_solutions(grid, ["ABC", "DEF"]), 1)

    def test_no_solution(self) -> None:
        grid = [list("ABC"), list("DEF")]
        self.assertEqual(count_strands_solutions(grid, ["ABC", "XYZ"]), 0)

    def test_prefix_search_finds_bent_paths(self) -> None:
        grid = [list("AB"), list("DC")]
        self.assertEqual(find_word_paths(grid, "ABCD"), [(0, 1, 3, 2)])

    def test_path_limit_raises(self) -> None:
        grid = [list("AAA"), list("AAA"), list("AAA")]
        with self.assertRaises(AmbiguityLimitExceeded):
            find_word_paths(grid, "AAAA", limit=10)

    def test_prefix_node_budget_interrupts_without_completed_paths(self) -> None:
        # No B exists: a completed-path cap alone cannot bound this search.
        with self.assertRaisesRegex(UniquenessBudgetExceeded, "not proved.*node budget"):
            find_word_paths([list("AAAA")] * 4, "AAAAAAAAAB", node_budget=10)

    def test_assignment_budget_is_shared_with_prefix_enumeration(self) -> None:
        with self.assertRaises(UniquenessBudgetExceeded):
            enumerate_strands_solutions([list("ABC"), list("DEF")], ["ABC", "DEF"], node_budget=6)

    def test_verification_never_accepts_interrupted_proof(self) -> None:
        payload = {"grid": [list("ABC"), list("DEF")], "words": [
            {"word": "ABC", "cells": [[0, 0], [0, 1], [0, 2]]},
            {"word": "DEF", "cells": [[1, 0], [1, 1], [1, 2]]},
        ]}
        with self.assertRaisesRegex(UniquenessBudgetExceeded, "not proved"):
            verify_strands_uniqueness(payload, node_budget=1)

    def test_deadline_checked_inside_prefix_search(self) -> None:
        with patch.object(strands_generator.time, "monotonic", side_effect=[0, 0, 2]):
            with self.assertRaisesRegex(StrandsGenerationError, "time limit"):
                find_word_paths([list("ABC")], "ABC", deadline=1)

    def test_verify_rejects_ambiguous_payload(self) -> None:
        payload = {
            "grid": [list("ABA"), list("BAB")],
            "words": [
                {"word": "ABA", "cells": [[0, 0], [0, 1], [0, 2]]},
                {"word": "BAB", "cells": [[1, 0], [1, 1], [1, 2]]},
            ],
        }
        with self.assertRaisesRegex(ValueError, "exactly one solution"):
            verify_strands_uniqueness(payload)

    def test_verify_accepts_unique_payload_and_checks_declared_cells(self) -> None:
        payload = {
            "grid": [list("ABC"), list("DEF")],
            "words": [
                {"word": "ABC", "cells": [[0, 0], [0, 1], [0, 2]]},
                {"word": "DEF", "cells": [[1, 0], [1, 1], [1, 2]]},
            ],
        }
        verify_strands_uniqueness(payload)
        payload["words"][0]["cells"] = [[0, 2], [0, 1], [0, 0]]
        with self.assertRaisesRegex(ValueError, "differs"):
            verify_strands_uniqueness(payload)


class TestPlacement(unittest.TestCase):
    def test_partition_covers_grid_without_crossings(self) -> None:
        lengths = [16, 10, 10, 9, 9, 9, 9, 9]
        rng = random.Random("placement")
        paths = None
        for _ in range(60):
            paths = place_strands_paths(lengths, 9, 9, rng)
            if paths is not None:
                break
        self.assertIsNotNone(paths)
        assert paths is not None
        self.assertEqual([len(p) for p in paths], lengths)
        cells = [cell for path in paths for cell in path]
        self.assertEqual(sorted(cells), list(range(81)))
        self.assertTrue(spans_opposite_sides_idx(paths[0], 9, 9))
        self.assertIsNone(find_crossing([[divmod(c, 9) for c in p] for p in paths]))

    def test_deadline_checked_during_placement(self) -> None:
        with patch.object(strands_generator.time, "monotonic", side_effect=[0, 2]):
            with self.assertRaisesRegex(StrandsGenerationError, "time limit"):
                place_strands_paths([3, 3], 2, 3, random.Random(0), deadline=1)

    def test_path_cap_is_recorded_as_unproved_not_ambiguous(self) -> None:
        stats = strands_generator.PlacementStats()
        with patch.object(strands_generator, "place_strands_paths", return_value=[[0, 1, 2], [3, 4, 5]]):
            with patch.object(strands_generator, "count_strands_solutions", side_effect=AmbiguityLimitExceeded("ABC")):
                result = strands_generator.solve_strands_grid(
                    ["ABC", "DEF"], 2, 3, random.Random(0), attempts=1, stats=stats,
                )
        self.assertIsNone(result)
        self.assertEqual(stats.ambiguous, 0)
        self.assertTrue(any("not proved" in event for event in stats.events))

    def test_solver_rejects_proof_returned_after_deadline(self) -> None:
        clock = [0.0]

        def late_count(*args, **kwargs):
            clock[0] = 2.0
            return 1

        with patch.object(strands_generator.time, "monotonic", side_effect=lambda: clock[0]):
            with patch.object(strands_generator, "place_strands_paths", return_value=[[0, 1, 2], [3, 4, 5]]):
                with patch.object(strands_generator, "count_strands_solutions", side_effect=late_count):
                    with self.assertRaisesRegex(StrandsGenerationError, "time limit"):
                        strands_generator.solve_strands_grid(["ABC", "DEF"], 2, 3, random.Random(0), deadline=1)

    def test_lengths_must_match_area(self) -> None:
        with self.assertRaises(ValueError):
            place_strands_paths([9, 9], 9, 9, random.Random(1))


class TestGenerateStrandsPuzzle(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = build_strands_test_database()

    def tearDown(self) -> None:
        self.conn.close()

    def _generate(self, seed: str, **kwargs):
        return generate_strands_puzzle(
            self.conn,
            seed=seed,
            reference_date=date(2026, 10, 21),
            theme_filter=ROSTER_THEME_ID,
            **kwargs,
        )

    def test_generated_puzzle_is_valid_and_unique(self) -> None:
        puzzle = self._generate("strands-valid")
        validate_strands_puzzle(puzzle)
        verify_strands_uniqueness(puzzle)
        self.assertEqual(puzzle["dimensions"], {"rows": 9, "cols": 9})
        spangram = puzzle["words"][0]
        self.assertTrue(spangram["is_spangram"])
        self.assertEqual(spangram["spangram_kind"], "entity")
        self.assertEqual(spangram["word"], "STARLIGHTORCHARD")
        self.assertEqual(len(puzzle["words"]), 8)

    def test_fixture_artifact_is_deterministic_across_sufficient_budgets(self) -> None:
        # This fictional in-memory fixture never reads data/kpop.db.
        first = self._generate("strands-determinism")
        second = self._generate("strands-determinism", uniqueness_node_budget=200000)
        self.assertEqual(first, second)
        self.assertEqual(json.dumps(first, ensure_ascii=False), json.dumps(second, ensure_ascii=False))

    def test_seed_variation_changes_grid(self) -> None:
        grids = {json.dumps(self._generate(f"strands-seed-{i}")["grid"]) for i in range(3)}
        self.assertGreater(len(grids), 1)

    def test_infeasible_theme_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(StrandsGenerationError, "spangram_too_short"):
            generate_strands_puzzle(self.conn, seed="x", theme_filter="members_q21480414")

    def test_unknown_theme_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(StrandsGenerationError, "No strands theme matches"):
            generate_strands_puzzle(self.conn, seed="x", theme_filter="no-such-theme")

    def test_ambiguous_grids_are_rejected(self) -> None:
        with patch.object(strands_generator, "count_strands_solutions", return_value=2):
            with self.assertRaisesRegex(StrandsGenerationError, "no unique 9x9 grid"):
                self._generate("strands-ambiguous", attempts=3, subsets_per_theme=1)

    def test_time_limit_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(StrandsGenerationError, "time limit"):
            self._generate("strands-deadline", time_limit_seconds=0)

    def test_uniqueness_budget_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(UniquenessBudgetExceeded, "node budget"):
            self._generate("strands-valid", uniqueness_node_budget=1)

    def test_expired_final_verification_cannot_return_artifact(self) -> None:
        clock = [0.0]

        def finish_after_deadline(*args, **kwargs):
            clock[0] = 2.0

        with patch.object(strands_generator.time, "monotonic", side_effect=lambda: clock[0]):
            with patch.object(strands_generator, "verify_strands_uniqueness", side_effect=finish_after_deadline):
                with self.assertRaisesRegex(StrandsGenerationError, "time limit"):
                    self._generate("strands-valid", time_limit_seconds=1)

    def test_invalid_dimensions(self) -> None:
        with self.assertRaises(ValueError):
            self._generate("strands-dims", rows=8)


class TestStrandsCLI(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        disk = sqlite3.connect(str(self.db_path))
        memory = build_strands_test_database()
        memory.backup(disk)
        disk.close()
        memory.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _run(self, *args: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with patch("sys.stdout", out), patch("sys.stderr", err):
            code = cli_main(["--database", str(self.db_path), *args])
        return code, out.getvalue(), err.getvalue()

    def test_nonexistent_database_returns_error(self) -> None:
        err = io.StringIO()
        with patch("sys.stderr", err):
            code = cli_main(["--database", str(Path(self.temp_dir.name) / "missing.db")])
        self.assertEqual(code, 1)
        self.assertIn("Database does not exist", err.getvalue())

    def test_stdout_generation_and_verify(self) -> None:
        code, out, _err = self._run("--date", "2026-10-21", "--theme", ROSTER_THEME_ID, "--verify")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        validate_strands_puzzle(payload)
        self.assertEqual(payload["reference_date"], "2026-10-21")

    def test_default_seed_follows_date(self) -> None:
        _c, first, _e = self._run("--date", "2026-10-21", "--theme", ROSTER_THEME_ID)
        _c, second, _e = self._run(
            "--date", "2026-10-21", "--theme", ROSTER_THEME_ID,
            "--seed", "kpop-strands-daily-2026-10-21",
        )
        self.assertEqual(first, second)

    def test_file_output(self) -> None:
        target = Path(self.temp_dir.name) / "strands.json"
        code, out, _err = self._run(
            "--theme", ROSTER_THEME_ID, "--seed", "cli-file", "--output", str(target), "--verify"
        )
        self.assertEqual(code, 0)
        self.assertIn("puzzle_id", out)
        validate_strands_puzzle(json.loads(target.read_text(encoding="utf-8")))

    def test_failure_returns_error(self) -> None:
        code, _out, err = self._run("--theme", "members_q21480414")
        self.assertEqual(code, 1)
        self.assertIn("StrandsGenerationError", err)

    def test_list_themes(self) -> None:
        code, out, _err = self._run("--list-themes")
        self.assertEqual(code, 0)
        report = {item["theme_id"]: item for item in json.loads(out)}
        self.assertEqual(report[ROSTER_THEME_ID]["feasibility"]["9x9"], "ok")
        self.assertEqual(len(report[ROSTER_THEME_ID]["discarded"]), 3)


class TestStrandsRealDatabase(unittest.TestCase):
    def test_real_database_daily_generation(self) -> None:
        real_db = Path("data/kpop.db")
        if not real_db.is_file():
            self.skipTest("data/kpop.db not available")
        conn = sqlite3.connect(f"{real_db.resolve().as_uri()}?mode=ro", uri=True)
        try:
            puzzles = [
                generate_strands_puzzle(
                    conn, seed="kpop-strands-daily-2026-10-21", reference_date=date(2026, 10, 21)
                )
                for _ in range(2)
            ]
        finally:
            conn.close()
        validate_strands_puzzle(puzzles[0])
        verify_strands_uniqueness(puzzles[0])
        self.assertEqual(puzzles[0], puzzles[1])


if __name__ == "__main__":
    unittest.main()
