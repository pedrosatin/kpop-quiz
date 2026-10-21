"""Contract tests for the Strands puzzle schema v1 and its validator."""

from __future__ import annotations

import json
import string
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

try:
    import fastjsonschema
except ImportError:
    fastjsonschema = None

from kpop_scraping.strands_schema import (
    STRANDS_SCHEMA_VERSION,
    are_neighbors,
    compute_strands_puzzle_id,
    find_crossing,
    spans_opposite_sides,
    validate_strands_puzzle,
    write_strands_puzzle_atomic,
)

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "strands-puzzle-v1.json"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "strands_puzzle_valid.json"

SCHEMA_JSON = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
JSON_VALIDATOR = (
    fastjsonschema.compile(SCHEMA_JSON) if fastjsonschema is not None else None
)

# Fixture layout (9x9, fictional names):
#   words[0] FAKEGROUP spangram, row 4 from col 0 to col 8
#   words[1] ALPHAMOONLIT rows 0-1, cols 0-5 (snake)
#   words[2] BRAVOSUNRISE rows 2-3, cols 0-5 (snake)
#   words[3] CHARLIESTARS rows 0-3, cols 6-8 (vertical snake)
#   words[4] DELTARAINBOW rows 5-6, cols 0-5
#   words[5] ECHOSNOWFALL rows 7-8, cols 0-5
#   words[6] FOXTROTCLOUD rows 5-8, cols 6-8


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def rehash(puzzle: dict) -> dict:
    puzzle["puzzle_id"] = compute_strands_puzzle_id(puzzle)
    return puzzle


def _entry(word: str, cells: list[list[int]], index: int, spangram: bool = False) -> dict:
    """Return a fictional word entry; letters are placed on the grid by the caller."""
    assert len(word) == len(cells), word
    entry = {
        "word": word,
        "labels": {"pt-BR": word.capitalize(), "en": word.capitalize()},
        "is_spangram": spangram,
        "cells": cells,
    }
    if spangram:
        entry["spangram_kind"] = "theme"
    else:
        entry["id"] = f"Q99100{index:04d}"
        entry["canonical_name"] = word.capitalize()
        entry["evidence"] = [
            {
                "fact_base_id": f"fixture-word-{index}",
                "locator": f"fixture/words/{word.lower()}",
                "revision_id": 1,
                "source_key": "fixture",
                "source_url": "https://example.org/strands-fixture",
            }
        ]
    return entry


def _assemble(rows: int, cols: int, words: list[dict]) -> dict:
    grid = [["?"] * cols for _ in range(rows)]
    for entry in words:
        for (r, c), letter in zip(entry["cells"], entry["word"]):
            grid[r][c] = letter
    assert all(cell != "?" for row in grid for cell in row), "fixture must cover the grid"
    puzzle = {
        "schema_version": STRANDS_SCHEMA_VERSION,
        "puzzle_id": "0" * 64,
        "dataset_version": "f" * 64,
        "reference_date": "2026-10-20",
        "theme": {"pt-BR": "Tema fictício", "en": "Fictional theme"},
        "dimensions": {"rows": rows, "cols": cols},
        "grid": grid,
        "words": words,
    }
    return rehash(puzzle)


def _snake(row: int, col_start: int, col_end: int) -> list[list[int]]:
    """Two-row snake: row left to right, then row + 1 right to left."""
    cols = list(range(col_start, col_end + 1))
    return [[row, c] for c in cols] + [[row + 1, c] for c in reversed(cols)]


def make_theme_spangram_puzzle() -> dict:
    """Fixture variant whose spangram is the theme expression NOSTALGIA."""
    puzzle = load_fixture()
    spangram = puzzle["words"][0]
    for key in ("id", "canonical_name", "evidence"):
        del spangram[key]
    spangram["word"] = "NOSTALGIA"
    spangram["labels"] = {"pt-BR": "Nostalgia", "en": "Throwback"}
    spangram["spangram_kind"] = "theme"
    for col, letter in enumerate("NOSTALGIA"):
        puzzle["grid"][4][col] = letter
    return rehash(puzzle)


def make_vertical_spangram_puzzle() -> dict:
    """9x9 grid with a spangram down column 0, four 2-row snakes and a last row."""
    words = [_entry("VERTICALS", [[r, 0] for r in range(9)], 0, spangram=True)]
    snake_words = [
        "ALPHAMOONLITSTAR",
        "BRAVOSUNRISEGLOW",
        "CHARLIECLOUDSNOW",
        "DELTARAINBOWMIST",
    ]
    for idx, (row, word) in enumerate(zip((0, 2, 4, 6), snake_words), start=1):
        words.append(_entry(word, _snake(row, 1, 8), idx))
    words.append(_entry("ECHOFALL", [[8, c] for c in range(1, 9)], 5))
    return _assemble(9, 9, words)


def make_wide_puzzle(transpose: bool = False) -> dict:
    """9x10 grid (or 10x9 when transposed): row-4 spangram and eight 2x5 snakes."""
    cells = [[4, c] for c in range(10)]
    words = [_entry("FAKEGROUPS", cells, 0, spangram=True)]
    index = 0
    for row in (0, 2, 5, 7):
        for col_start in (0, 5):
            index += 1
            letters = string.ascii_uppercase[index : index + 10]
            words.append(_entry(letters, _snake(row, col_start, col_start + 4), index))
    rows, cols = 9, 10
    if transpose:
        for entry in words:
            entry["cells"] = [[c, r] for r, c in entry["cells"]]
        rows, cols = cols, rows
    return _assemble(rows, cols, words)


class TestStrandsSchemaValidation(unittest.TestCase):
    def assertInvalid(self, puzzle: dict, pattern: str) -> None:
        with self.assertRaisesRegex(ValueError, pattern):
            validate_strands_puzzle(puzzle)

    def test_fixture_is_valid(self):
        puzzle = load_fixture()
        self.assertEqual(puzzle["schema_version"], STRANDS_SCHEMA_VERSION)
        validate_strands_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def assertSchemaRejects(self, puzzle: dict) -> None:
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_theme_spangram_is_valid(self):
        puzzle = make_theme_spangram_puzzle()
        spangram = puzzle["words"][0]
        self.assertEqual(spangram["spangram_kind"], "theme")
        self.assertNotIn("id", spangram)
        validate_strands_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_theme_spangram_rejects_entity_fields(self):
        for field in ("id", "canonical_name", "evidence"):
            puzzle = make_theme_spangram_puzzle()
            puzzle["words"][0][field] = load_fixture()["words"][0][field]
            rehash(puzzle)
            self.assertInvalid(puzzle, "theme spangram cannot carry")
            self.assertSchemaRejects(puzzle)

    def test_theme_spangram_needs_one_matching_label(self):
        puzzle = make_theme_spangram_puzzle()
        puzzle["words"][0]["labels"] = {"pt-BR": "Anos 90", "en": "Nineties"}
        rehash(puzzle)
        self.assertInvalid(puzzle, "at least one locale")

    def test_entity_spangram_requires_entity_fields(self):
        for field in ("id", "canonical_name", "evidence"):
            puzzle = load_fixture()
            del puzzle["words"][0][field]
            self.assertInvalid(puzzle, "entity spangram requires")
            self.assertSchemaRejects(puzzle)

    def test_entity_spangram_requires_both_labels_to_match(self):
        puzzle = load_fixture()
        puzzle["words"][0]["labels"]["en"] = "Unrelated name"
        self.assertInvalid(puzzle, r"labels\.en normalizes to")

        puzzle = load_fixture()
        puzzle["words"][0]["labels"] = {"pt-BR": "Grupo", "en": "Group"}
        self.assertInvalid(puzzle, "does not match word")

    def test_spangram_kind_is_required_and_closed(self):
        puzzle = load_fixture()
        del puzzle["words"][0]["spangram_kind"]
        self.assertInvalid(puzzle, "spangram_kind must be")
        self.assertSchemaRejects(puzzle)

        puzzle = load_fixture()
        puzzle["words"][0]["spangram_kind"] = "group"
        self.assertInvalid(puzzle, "spangram_kind must be")
        self.assertSchemaRejects(puzzle)

    def test_spangram_kind_is_rejected_on_regular_words(self):
        puzzle = load_fixture()
        puzzle["words"][1]["spangram_kind"] = "entity"
        self.assertInvalid(puzzle, "only allowed on the spangram")
        self.assertSchemaRejects(puzzle)

    def test_json_schema_requires_exactly_one_spangram(self):
        words_schema = SCHEMA_JSON["properties"]["words"]
        self.assertEqual(words_schema["minContains"], 1)
        self.assertEqual(words_schema["maxContains"], 1)

        # fastjsonschema implements `contains` but ignores maxContains, so only
        # the missing-spangram case is exercised through it; the validator
        # covers two spangrams in test_rejects_two_spangrams.
        puzzle = load_fixture()
        puzzle["words"][0]["is_spangram"] = False
        del puzzle["words"][0]["spangram_kind"]
        self.assertSchemaRejects(puzzle)

    def test_theme_description_is_optional_and_bilingual(self):
        puzzle = load_fixture()
        self.assertIn("theme_description", puzzle)
        del puzzle["theme_description"]
        rehash(puzzle)
        validate_strands_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

        puzzle = load_fixture()
        del puzzle["theme_description"]["en"]
        rehash(puzzle)
        self.assertInvalid(puzzle, "theme_description fields must be pt-BR and en")
        self.assertSchemaRejects(puzzle)

        puzzle = load_fixture()
        puzzle["theme_description"]["pt-BR"] = ""
        rehash(puzzle)
        self.assertInvalid(puzzle, r"theme_description\.pt-BR")
        self.assertSchemaRejects(puzzle)

    def test_accepts_vertical_spangram(self):
        puzzle = make_vertical_spangram_puzzle()
        spangram = puzzle["words"][0]
        self.assertEqual(spangram["cells"][0], [0, 0])
        self.assertEqual(spangram["cells"][-1], [8, 0])
        validate_strands_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_accepts_non_square_grids(self):
        for transpose, rows, cols in ((False, 9, 10), (True, 10, 9)):
            with self.subTest(rows=rows, cols=cols):
                puzzle = make_wide_puzzle(transpose)
                self.assertEqual(puzzle["dimensions"], {"rows": rows, "cols": cols})
                self.assertEqual(len(puzzle["grid"]), rows)
                self.assertEqual(len(puzzle["grid"][0]), cols)
                validate_strands_puzzle(puzzle)
                if JSON_VALIDATOR:
                    JSON_VALIDATOR(puzzle)

    def test_theme_word_requires_entity_fields(self):
        puzzle = load_fixture()
        del puzzle["words"][1]["evidence"]
        self.assertInvalid(puzzle, "theme word requires")
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_rejects_invalid_root(self):
        puzzle = load_fixture()
        puzzle["schema_version"] = "kpop-word-search-puzzle-v1"
        self.assertInvalid(puzzle, "schema_version")

        puzzle = load_fixture()
        puzzle["extra"] = 1
        self.assertInvalid(puzzle, "unexpected fields")

        puzzle = load_fixture()
        del puzzle["theme"]
        self.assertInvalid(puzzle, "missing required fields")

        puzzle = load_fixture()
        puzzle["reference_date"] = "2026-02-30"
        self.assertInvalid(puzzle, "calendar date")

        puzzle = load_fixture()
        puzzle["dataset_version"] = "abc"
        self.assertInvalid(puzzle, "dataset_version")

    def test_theme_must_be_bilingual(self):
        puzzle = load_fixture()
        puzzle["theme"] = {"pt-BR": "Somente português"}
        self.assertInvalid(puzzle, "theme fields must be pt-BR and en")

        puzzle = load_fixture()
        puzzle["theme"]["en"] = ""
        self.assertInvalid(puzzle, "theme.en")

    def test_rejects_dimensions_outside_range(self):
        for rows, cols in ((8, 9), (9, 11), (16, 16)):
            puzzle = load_fixture()
            puzzle["dimensions"] = {"rows": rows, "cols": cols}
            self.assertInvalid(puzzle, "between 9 and 10")

        puzzle = load_fixture()
        puzzle["dimensions"] = {"rows": True, "cols": 9}
        self.assertInvalid(puzzle, "dimensions.rows")

    def test_rejects_grid_dimension_mismatch(self):
        puzzle = load_fixture()
        puzzle["dimensions"]["rows"] = 10
        self.assertInvalid(puzzle, "grid row count")

        puzzle = load_fixture()
        puzzle["grid"][0][0] = "a"
        self.assertInvalid(puzzle, r"grid\[0\]\[0\]")

    def test_rejects_missing_spangram(self):
        puzzle = load_fixture()
        puzzle["words"][0]["is_spangram"] = False
        del puzzle["words"][0]["spangram_kind"]
        self.assertInvalid(puzzle, "exactly one word must be the spangram, got 0")

    def test_rejects_two_spangrams(self):
        puzzle = load_fixture()
        puzzle["words"][3]["is_spangram"] = True
        puzzle["words"][3]["spangram_kind"] = "entity"
        self.assertInvalid(puzzle, "exactly one word must be the spangram, got 2")

    def test_rejects_spangram_that_does_not_span(self):
        puzzle = load_fixture()
        # CHARLIESTARS touches the top and right sides only.
        puzzle["words"][0]["is_spangram"] = False
        del puzzle["words"][0]["spangram_kind"]
        puzzle["words"][3]["is_spangram"] = True
        puzzle["words"][3]["spangram_kind"] = "entity"
        self.assertInvalid(puzzle, "opposite sides")

    def test_rejects_cell_reused_across_words(self):
        puzzle = load_fixture()
        # ALPHAMOONLIT ends at (1,0) after (1,1); (2,0) is adjacent but owned
        # by BRAVOSUNRISE.
        puzzle["words"][1]["cells"][-1] = [2, 0]
        self.assertInvalid(puzzle, r"reuses cell \[2, 0\]")

    def test_rejects_cell_reused_within_word(self):
        puzzle = load_fixture()
        cells = puzzle["words"][1]["cells"]
        cells[2] = cells[0]
        self.assertInvalid(puzzle, "reuses cell")

    def test_rejects_uncovered_grid(self):
        puzzle = load_fixture()
        del puzzle["words"][6]
        self.assertInvalid(puzzle, "not fully covered; 12 cells")

    def test_rejects_non_adjacent_path(self):
        puzzle = load_fixture()
        cells = puzzle["words"][1]["cells"]
        cells[0], cells[5] = cells[5], cells[0]
        self.assertInvalid(puzzle, "is not adjacent")

    def test_rejects_cells_that_do_not_spell_word(self):
        puzzle = load_fixture()
        puzzle["grid"][0][0] = "Z"
        self.assertInvalid(puzzle, "does not match grid letters")

    def test_rejects_word_length_cell_count_mismatch(self):
        puzzle = load_fixture()
        puzzle["words"][1]["cells"].pop()
        self.assertInvalid(puzzle, "does not match cell count")

    def test_rejects_cell_out_of_bounds_or_malformed(self):
        puzzle = load_fixture()
        puzzle["words"][0]["cells"][-1] = [4, 9]
        self.assertInvalid(puzzle, "col")

        puzzle = load_fixture()
        puzzle["words"][0]["cells"][0] = {"row": 4, "col": 0}
        self.assertInvalid(puzzle, r"\[row, col\] pair")

        puzzle = load_fixture()
        puzzle["words"][0]["cells"][0] = [True, 0]
        self.assertInvalid(puzzle, "row")

    def test_rejects_word_count_out_of_range(self):
        puzzle = load_fixture()
        del puzzle["words"][5:]
        self.assertInvalid(puzzle, "between 6 and 9 items")

        puzzle = load_fixture()
        for idx in range(3):
            extra = deepcopy(puzzle["words"][1])
            extra["word"] = f"EXTRA{'ABC'[idx]}"
            puzzle["words"].append(extra)
        self.assertEqual(len(puzzle["words"]), 10)
        self.assertInvalid(puzzle, "between 6 and 9 items")

    def test_rejects_duplicate_word_or_id(self):
        puzzle = load_fixture()
        puzzle["words"][2]["id"] = puzzle["words"][1]["id"]
        self.assertInvalid(puzzle, "duplicate word id")

        puzzle = load_fixture()
        puzzle["words"][2]["word"] = puzzle["words"][1]["word"]
        self.assertInvalid(puzzle, "duplicate word")

    def test_rejects_labels_that_do_not_normalize_to_word(self):
        puzzle = load_fixture()
        puzzle["words"][1]["labels"]["en"] = "Alpha"
        self.assertInvalid(puzzle, "does not match word")

    def test_rejects_invalid_evidence(self):
        puzzle = load_fixture()
        puzzle["words"][1]["evidence"][0]["source_url"] = "http://example.org"
        self.assertInvalid(puzzle, "https URL")

        puzzle = load_fixture()
        puzzle["words"][1]["evidence"][0]["revision_id"] = 0
        self.assertInvalid(puzzle, "revision_id")

        puzzle = load_fixture()
        puzzle["words"][1]["evidence"] = []
        self.assertInvalid(puzzle, "non-empty array")

    def test_rejects_divergent_hash(self):
        puzzle = load_fixture()
        puzzle["theme"]["en"] = "Another theme"
        self.assertInvalid(puzzle, "puzzle_id does not match content hash")

        rehash(puzzle)
        validate_strands_puzzle(puzzle)


class TestStrandsPathHelpers(unittest.TestCase):
    def test_are_neighbors_uses_eight_directions(self):
        center = (4, 4)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                expected = (dr, dc) != (0, 0)
                self.assertEqual(are_neighbors(center, (4 + dr, 4 + dc)), expected)
        self.assertFalse(are_neighbors(center, (6, 4)))
        self.assertFalse(are_neighbors(center, (5, 6)))

    def test_spans_opposite_sides(self):
        self.assertTrue(spans_opposite_sides([(0, 3), (1, 3), (2, 3)], 3, 9))
        self.assertTrue(spans_opposite_sides([(1, 0), (1, 1), (2, 2)], 9, 3))
        # Touching two adjacent sides (top and left) is not enough.
        self.assertFalse(spans_opposite_sides([(0, 0), (1, 1)], 9, 9))

    def test_find_crossing_between_words(self):
        self.assertEqual(
            find_crossing([[(0, 0), (1, 1)], [(0, 1), (1, 0)]]), ((0, 0), (1, 1))
        )
        self.assertIsNone(find_crossing([[(0, 0), (1, 1)], [(0, 1), (1, 2)]]))

    def test_find_crossing_within_word(self):
        # (0,0)->(1,1)->(1,0)->(0,1) draws an X inside one path.
        self.assertIsNotNone(find_crossing([[(0, 0), (1, 1), (1, 0), (0, 1)]]))

    def test_validator_rejects_crossing_paths(self):
        puzzle = load_fixture()
        alpha = puzzle["words"][1]
        # ALPHAMOONLIT turns through (0,4)->(0,5)->(1,5)->(1,4). Rerouting it
        # as (0,4)->(1,5)->(0,5)->(1,4) draws two crossing diagonals.
        cells = alpha["cells"]
        self.assertEqual(cells[4:8], [[0, 4], [0, 5], [1, 5], [1, 4]])
        cells[4:8] = [[0, 4], [1, 5], [0, 5], [1, 4]]
        for (r, c), ch in zip(cells, alpha["word"]):
            puzzle["grid"][r][c] = ch
        self.assertInvalid(puzzle, "crosses another diagonal step")

    def test_validator_rejects_x_crossing_between_different_words(self):
        puzzle = load_fixture()
        alpha, bravo = puzzle["words"][1], puzzle["words"][2]
        # ALPHAMOONLIT ends (1,1)->(2,0) and BRAVOSUNRISE starts (1,0)->(2,1):
        # the two diagonals of the square rows 1-2, cols 0-1 cross. The grid
        # stays fully covered and every path stays contiguous.
        alpha["cells"] = (
            [[0, c] for c in range(6)] + [[1, c] for c in range(5, 0, -1)] + [[2, 0]]
        )
        bravo["cells"] = (
            [[1, 0]] + [[2, c] for c in range(1, 6)] + [[3, c] for c in range(5, -1, -1)]
        )
        for entry in (alpha, bravo):
            for (r, c), letter in zip(entry["cells"], entry["word"]):
                puzzle["grid"][r][c] = letter
        rehash(puzzle)
        self.assertInvalid(puzzle, r"crosses another diagonal step")

    def assertInvalid(self, puzzle: dict, pattern: str) -> None:
        with self.assertRaisesRegex(ValueError, pattern):
            validate_strands_puzzle(puzzle)


class TestStrandsPersistence(unittest.TestCase):
    def test_write_strands_puzzle_atomic(self):
        puzzle = load_fixture()
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "strands.json"
            content = write_strands_puzzle_atomic(target, puzzle)
            self.assertEqual(target.read_bytes(), content)
            self.assertEqual(json.loads(content)["puzzle_id"], puzzle["puzzle_id"])

            broken = deepcopy(puzzle)
            broken["grid"][4][0] = "Z"
            with self.assertRaises(ValueError):
                write_strands_puzzle_atomic(target, broken)
            self.assertEqual(target.read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
