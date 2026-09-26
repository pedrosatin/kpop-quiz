"""Unit tests for word search puzzle schema v1 and validation."""

from __future__ import annotations

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

try:
    import fastjsonschema
except ImportError:
    fastjsonschema = None

from kpop_scraping.word_search_schema import (
    WORD_SEARCH_SCHEMA_VERSION,
    check_word_in_grid,
    extract_word_coordinates,
    generate_word_search_share_summary,
    validate_word_search_puzzle,
    write_word_search_puzzle_atomic,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "schemas" / "word-search-puzzle-v1.json"
)


def sample_evidence(fact_id: str = "fb-1", qid: str = "Q21480414") -> dict:
    return {
        "fact_base_id": fact_id,
        "locator": f"claims/P31/{qid}$1234/references/hash1",
        "revision_id": 1001,
        "source_key": "wikidata",
        "source_url": f"https://www.wikidata.org/wiki/{qid}",
    }


def sample_word_search_puzzle() -> dict:
    """Return a complete, valid sample word search puzzle covering all 8 directions."""
    grid = [["X" for _ in range(12)] for _ in range(12)]

    words_data = [
        # (word, qid, canonical, start_r, start_c, end_r, end_c, clue_pt, clue_en)
        # 1. Horizontal L->R
        ("TWICE", "Q21480414", "TWICE", 0, 0, 0, 4, "Grupo feminino da JYP", "JYP girl group"),
        # 2. Horizontal R->L
        ("STAYC", "Q100254098", "STAYC", 1, 6, 1, 2, "Grupo da High Up", "High Up girl group"),
        # 3. Vertical T->B
        ("AESPA", "Q100877964", "aespa", 2, 0, 6, 0, "Grupo da SM Entertainment", "SM Entertainment girl group"),
        # 4. Vertical B->T
        ("ITZY", "Q60738096", "ITZY", 7, 1, 4, 1, "Grupo feminino de 5 integrantes", "5-member girl group"),
        # 5. Diagonal Down-Right
        ("IVE", "Q109341434", "IVE", 2, 2, 4, 4, "Grupo da Starship", "Starship girl group"),
        # 6. Diagonal Down-Left
        ("NEWJEANS", "Q113189271", "NewJeans", 3, 11, 10, 4, "Grupo da ADOR", "ADOR girl group"),
        # 7. Diagonal Up-Right
        ("KARA", "Q489816", "KARA", 11, 0, 8, 3, "Grupo clássico da segunda geração", "Classic 2nd gen group"),
        # 8. Diagonal Up-Left
        ("REDVELVET", "Q17425336", "Red Velvet", 10, 11, 2, 3, "Grupo da SM de cinco integrantes", "SM 5-member girl group"),
    ]

    for word, _, _, sr, sc, er, ec, _, _ in words_data:
        coords = extract_word_coordinates(sr, sc, er, ec)
        for idx, (r, c) in enumerate(coords):
            grid[r][c] = word[idx]

    words = []
    for word, qid, canonical, sr, sc, er, ec, clue_pt, clue_en in words_data:
        words.append(
            {
                "id": qid,
                "word": word,
                "canonical_name": canonical,
                "labels": {
                    "pt-BR": canonical,
                    "en": canonical,
                },
                "start_row": sr,
                "start_col": sc,
                "end_row": er,
                "end_col": ec,
                "clue": {
                    "pt-BR": clue_pt,
                    "en": clue_en,
                },
                "evidence": [sample_evidence(f"fb-{qid}", qid)],
            }
        )

    return {
        "schema_version": WORD_SEARCH_SCHEMA_VERSION,
        "puzzle_id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "dataset_version": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        "reference_date": "2026-09-18",
        "theme": {
            "pt-BR": "Grupos Femininos de K-pop",
            "en": "K-pop Girl Groups",
        },
        "theme_description": {
            "pt-BR": "Encontre nomes de grupos femininos renomados na grade.",
            "en": "Find renowned girl group names in the grid.",
        },
        "dimensions": {
            "rows": 12,
            "cols": 12,
        },
        "grid": grid,
        "words": words,
    }


SCHEMA_JSON = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
JSON_VALIDATOR = (
    fastjsonschema.compile(SCHEMA_JSON) if fastjsonschema is not None else None
)


class TestWordSearchSchemaValidation(unittest.TestCase):
    """Test validation of word search puzzle structures and constraints."""

    def test_sample_puzzle_is_valid(self):
        puzzle = sample_word_search_puzzle()
        validate_word_search_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_sample_puzzle_without_optional_fields_is_valid(self):
        puzzle = sample_word_search_puzzle()
        del puzzle["theme_description"]
        for w in puzzle["words"]:
            del w["clue"]
        validate_word_search_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_reject_invalid_schema_version(self):
        puzzle = sample_word_search_puzzle()
        puzzle["schema_version"] = "invalid-v1"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_puzzle_id(self):
        puzzle = sample_word_search_puzzle()
        puzzle["puzzle_id"] = "short-hash"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["puzzle_id"] = "Z" * 64
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["puzzle_id"] = 12345
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_dataset_version(self):
        puzzle = sample_word_search_puzzle()
        puzzle["dataset_version"] = "not-a-hash"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_reference_date(self):
        puzzle = sample_word_search_puzzle()
        puzzle["reference_date"] = "2026/09/18"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["reference_date"] = "2026-02-30"  # Invalid calendar date
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["reference_date"] = "2026-13-01"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_theme(self):
        puzzle = sample_word_search_puzzle()
        puzzle["theme"] = {"pt-BR": "Tema sem versao em ingles"}
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["theme"] = {"pt-BR": "", "en": "Empty Portuguese"}
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["theme"] = "String theme"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_theme_description(self):
        puzzle = sample_word_search_puzzle()
        puzzle["theme_description"] = {"pt-BR": "Descricao sem ingles"}
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["theme_description"] = "A plain string"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_dimensions(self):
        puzzle = sample_word_search_puzzle()
        puzzle["dimensions"] = {"rows": 6, "cols": 12}  # rows < 8
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["dimensions"] = {"rows": 12, "cols": 18}  # cols > 16
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["dimensions"] = {"rows": 12.0, "cols": 12}  # non-int
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["dimensions"] = {"rows": True, "cols": 12}  # bool
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["dimensions"] = {"rows": 12, "cols": 12, "extra": 1}
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_grid_dimension_mismatch(self):
        puzzle = sample_word_search_puzzle()
        puzzle["grid"].pop()  # 11 rows instead of 12
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0].pop()  # row 0 has 11 cols instead of 12
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_grid_characters(self):
        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0][0] = "a"  # lowercase
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0][0] = "1"  # digit
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0][0] = "Á"  # accented
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0][0] = ""  # empty
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["grid"][0][0] = "AB"  # multi-char
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_words_count_out_of_range(self):
        puzzle = sample_word_search_puzzle()
        puzzle["words"] = puzzle["words"][:2]  # Only 2 words (min is 3)
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        # > 20 words
        puzzle = sample_word_search_puzzle()
        words_list = []
        for i in range(21):
            w = deepcopy(puzzle["words"][0])
            w["id"] = f"Q{1000 + i}"
            w["word"] = f"W{i:02d}" + "A" * (3 - len(f"W{i:02d}"))
            words_list.append(w)
        puzzle["words"] = words_list
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_duplicate_words_or_qids(self):
        puzzle = sample_word_search_puzzle()
        # Duplicate QID
        puzzle["words"][1]["id"] = puzzle["words"][0]["id"]
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        # Duplicate word
        puzzle = sample_word_search_puzzle()
        puzzle["words"][1]["word"] = puzzle["words"][0]["word"]
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_word_missing_or_extra_fields(self):
        puzzle = sample_word_search_puzzle()
        del puzzle["words"][0]["canonical_name"]
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["extra_field"] = "unexpected"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_qid_in_word(self):
        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["id"] = "P21480414"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["words"][0]["id"] = "Q0"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_word_pattern(self):
        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["word"] = "tw"  # too short
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["words"][0]["word"] = "A" * 17  # too long
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle["words"][0]["word"] = "TW ICE"  # space
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_coordinates_out_of_bounds(self):
        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["start_row"] = 12  # grid rows is 12, max index is 11
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["end_col"] = -1
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["start_col"] = 12
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_coordinates_non_linear(self):
        puzzle = sample_word_search_puzzle()
        # L-shaped jump: row +1, col +2
        puzzle["words"][0]["start_row"] = 0
        puzzle["words"][0]["start_col"] = 0
        puzzle["words"][0]["end_row"] = 1
        puzzle["words"][0]["end_col"] = 2
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_word_length_mismatch_with_coordinates(self):
        puzzle = sample_word_search_puzzle()
        # Word is TWICE (5 letters), but coordinates span 4 letters
        puzzle["words"][0]["end_col"] = 3
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_word_letters_mismatch_with_grid(self):
        puzzle = sample_word_search_puzzle()
        # Word is TWICE, but change grid cell to 'Z'
        puzzle["grid"][0][0] = "Z"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_word_label_mismatch_with_word(self):
        puzzle = sample_word_search_puzzle()
        # Word is TWICE, but label normalizes to something different
        puzzle["words"][0]["labels"]["en"] = "I.N"
        with self.assertRaisesRegex(ValueError, "does not match word"):
            validate_word_search_puzzle(puzzle)

    def test_reject_invalid_evidence(self):
        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["evidence"] = []  # empty evidence
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["evidence"][0]["source_url"] = "http://insecure.org"  # http
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        puzzle["words"][0]["evidence"][0]["revision_id"] = 0  # < 1
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

        puzzle = sample_word_search_puzzle()
        del puzzle["words"][0]["evidence"][0]["locator"]
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)

    def test_reject_root_extra_fields(self):
        puzzle = sample_word_search_puzzle()
        puzzle["unexpected_field"] = "extra"
        with self.assertRaises(ValueError):
            validate_word_search_puzzle(puzzle)


class TestWordSearchCoordinatesAndExtraction(unittest.TestCase):
    """Test coordinate math, grid extraction, and direction handling."""

    def test_extract_all_eight_directions(self):
        # 1. Horizontal L->R
        self.assertEqual(
            extract_word_coordinates(2, 1, 2, 4),
            [(2, 1), (2, 2), (2, 3), (2, 4)],
        )
        # 2. Horizontal R->L
        self.assertEqual(
            extract_word_coordinates(2, 4, 2, 1),
            [(2, 4), (2, 3), (2, 2), (2, 1)],
        )
        # 3. Vertical T->B
        self.assertEqual(
            extract_word_coordinates(1, 3, 4, 3),
            [(1, 3), (2, 3), (3, 3), (4, 3)],
        )
        # 4. Vertical B->T
        self.assertEqual(
            extract_word_coordinates(4, 3, 1, 3),
            [(4, 3), (3, 3), (2, 3), (1, 3)],
        )
        # 5. Diagonal Down-Right
        self.assertEqual(
            extract_word_coordinates(1, 1, 3, 3),
            [(1, 1), (2, 2), (3, 3)],
        )
        # 6. Diagonal Down-Left
        self.assertEqual(
            extract_word_coordinates(1, 3, 3, 1),
            [(1, 3), (2, 2), (3, 1)],
        )
        # 7. Diagonal Up-Right
        self.assertEqual(
            extract_word_coordinates(3, 1, 1, 3),
            [(3, 1), (2, 2), (1, 3)],
        )
        # 8. Diagonal Up-Left
        self.assertEqual(
            extract_word_coordinates(3, 3, 1, 1),
            [(3, 3), (2, 2), (1, 1)],
        )

    def test_extract_coordinates_rejects_invalid_inputs(self):
        with self.assertRaises(ValueError):
            extract_word_coordinates(0, 0, 0, 0)  # Same cell

        with self.assertRaises(ValueError):
            extract_word_coordinates(0, 0, 1, 2)  # Knight move

        with self.assertRaises(ValueError):
            extract_word_coordinates("0", 0, 1, 1)  # Non-int

        with self.assertRaises(ValueError):
            extract_word_coordinates(True, 0, 1, 1)  # Bool

    def test_check_word_in_grid(self):
        grid = [
            ["A", "B", "C"],
            ["D", "E", "F"],
            ["G", "H", "I"],
        ]
        self.assertEqual(check_word_in_grid(grid, 0, 0, 0, 2), "ABC")
        self.assertEqual(check_word_in_grid(grid, 2, 2, 0, 0), "IEA")
        self.assertEqual(check_word_in_grid(grid, 2, 0, 0, 2), "GEC")

        with self.assertRaises(ValueError):
            check_word_in_grid(grid, 0, 0, 0, 5)  # Out of bounds

        with self.assertRaises(ValueError):
            check_word_in_grid([], 0, 0, 0, 1)  # Empty grid


class TestWordSearchShareSummaryAndIO(unittest.TestCase):
    """Test share summary generation and atomic puzzle persistence."""

    def test_generate_share_summary(self):
        summary_no_time = generate_word_search_share_summary("2026-09-18", 6, 8)
        self.assertEqual(summary_no_time, "K-pop Word Search 2026-09-18 6/8")

        summary_with_time = generate_word_search_share_summary(
            "2026-09-18", 8, 8, elapsed_seconds=135
        )
        self.assertEqual(summary_with_time, "K-pop Word Search 2026-09-18 8/8 (02:15)")

        summary_zero_seconds = generate_word_search_share_summary(
            "2026-09-18", 0, 8, elapsed_seconds=0
        )
        self.assertEqual(summary_zero_seconds, "K-pop Word Search 2026-09-18 0/8 (00:00)")

    def test_write_word_search_puzzle_atomic(self):
        puzzle = sample_word_search_puzzle()
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = Path(tmpdir) / "puzzle.json"
            raw_bytes = write_word_search_puzzle_atomic(out_file, puzzle)

            self.assertTrue(out_file.is_file())
            loaded = json.loads(out_file.read_text(encoding="utf-8"))
            self.assertEqual(loaded["puzzle_id"], puzzle["puzzle_id"])
            self.assertEqual(len(raw_bytes), len(out_file.read_bytes()))

            # Rejection on invalid payload
            invalid_puzzle = deepcopy(puzzle)
            invalid_puzzle["puzzle_id"] = "invalid"
            with self.assertRaises(ValueError):
                write_word_search_puzzle_atomic(out_file, invalid_puzzle)


if __name__ == "__main__":
    unittest.main()
