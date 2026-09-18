"""Unit tests for name guess puzzle schema v1 and validation."""

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

from kpop_scraping.name_guess_schema import (
    NAME_GUESS_SCHEMA_VERSION,
    compute_guess_feedback,
    generate_share_summary,
    normalize_name,
    validate_name_guess_puzzle,
    write_name_guess_puzzle_atomic,
)

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "name-guess-v1.json"


def sample_evidence(fact_id: str = "fb-1") -> dict:
    return {
        "fact_base_id": fact_id,
        "locator": "claims/P264/Q21480414$1234/references/hash1",
        "revision_id": 1001,
        "source_key": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q21480414",
    }


def sample_name_guess_puzzle() -> dict:
    """Return a complete, valid sample name guess puzzle matching schemas/name-guess-v1.json."""
    return {
        "schema_version": NAME_GUESS_SCHEMA_VERSION,
        "puzzle_id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "dataset_version": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        "reference_date": "2026-09-18",
        "word_length": 5,
        "max_attempts": 6,
        "target": {
            "id": "Q21480414",
            "canonical_name": "TWICE",
            "normalized_name": "TWICE",
            "labels": {
                "pt-BR": "TWICE",
                "en": "TWICE",
            },
            "entity_type": "group",
            "clues": {
                "debut_year": 2015,
                "agency": "JYP Entertainment",
                "members_count": 9,
                "description": {
                    "pt-BR": "Grupo feminino de 9 integrantes formado pela JYP Entertainment em 2015.",
                    "en": "9-member girl group formed by JYP Entertainment in 2015.",
                },
            },
            "evidence": [sample_evidence("fb-target-1")],
        },
        "valid_guesses": [
            "TWICE",
            "AESPA",
            "STAYC",
            "LOONA",
            "FIFTY",
            "BRAVE",
            "HELLO",
        ],
    }


SCHEMA_JSON = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
JSON_VALIDATOR = (
    fastjsonschema.compile(SCHEMA_JSON) if fastjsonschema is not None else None
)


class TestNameGuessSchemaValidation(unittest.TestCase):
    """Test validation of name guess puzzle structures and constraints."""

    def test_sample_puzzle_is_valid(self):
        puzzle = sample_name_guess_puzzle()
        validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_sample_puzzle_without_optional_clues_is_valid(self):
        puzzle = sample_name_guess_puzzle()
        del puzzle["target"]["clues"]
        validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_sample_puzzle_with_partial_clues_is_valid(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["target"]["clues"] = {
            "debut_year": 2015,
            "agency": {
                "pt-BR": "JYP Entertainment",
                "en": "JYP Entertainment",
            },
        }
        validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            JSON_VALIDATOR(puzzle)

    def test_missing_root_field_fails(self):
        puzzle = sample_name_guess_puzzle()
        del puzzle["valid_guesses"]
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("missing or extra fields", str(ctx.exception))
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_extra_root_field_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["unexpected"] = "field"
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("missing or extra fields", str(ctx.exception))
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_invalid_schema_version_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["schema_version"] = "invalid-version"
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("schema_version must be", str(ctx.exception))
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_invalid_hash_fields_fail(self):
        for field in ("puzzle_id", "dataset_version"):
            for bad_hash in ("short", "G" * 64, 12345, "a" * 63, "a" * 65):
                puzzle = sample_name_guess_puzzle()
                puzzle[field] = bad_hash
                with self.assertRaises(ValueError):
                    validate_name_guess_puzzle(puzzle)
                if JSON_VALIDATOR:
                    with self.assertRaises(fastjsonschema.JsonSchemaException):
                        JSON_VALIDATOR(puzzle)

    def test_invalid_reference_date_fails(self):
        for bad_date in ("2026/09/18", "2026-13-01", "2026-02-29", "not-a-date"):
            puzzle = sample_name_guess_puzzle()
            puzzle["reference_date"] = bad_date
            with self.assertRaises(ValueError):
                validate_name_guess_puzzle(puzzle)
            if JSON_VALIDATOR and bad_date not in ("2026-02-29", "2026-13-01"):
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(puzzle)

    def test_invalid_word_length_fails(self):
        for bad_len in (2, 11, "5", True, False):
            puzzle = sample_name_guess_puzzle()
            puzzle["word_length"] = bad_len
            with self.assertRaises(ValueError):
                validate_name_guess_puzzle(puzzle)
            if JSON_VALIDATOR:
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(puzzle)

        # Float fails Python strict int check
        puzzle_float = sample_name_guess_puzzle()
        puzzle_float["word_length"] = 5.0
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle_float)

    def test_invalid_max_attempts_fails(self):
        for bad_attempts in (3, 9, "6", True, False):
            puzzle = sample_name_guess_puzzle()
            puzzle["max_attempts"] = bad_attempts
            with self.assertRaises(ValueError):
                validate_name_guess_puzzle(puzzle)
            if JSON_VALIDATOR:
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(puzzle)

        # Float fails Python strict int check
        puzzle_float = sample_name_guess_puzzle()
        puzzle_float["max_attempts"] = 6.0
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle_float)

    def test_target_normalized_name_mismatch_with_word_length_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["target"]["normalized_name"] = "AESPA"  # length 5
        puzzle["word_length"] = 6
        puzzle["valid_guesses"] = ["TWICES", "AESPAS"]
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("does not match word_length", str(ctx.exception))

    def test_target_normalized_name_with_invalid_characters_fails(self):
        for bad_name in ("twice", "TW1CE", "TW-CE", "TW ICE", "TWÏCE"):
            puzzle = sample_name_guess_puzzle()
            puzzle["target"]["normalized_name"] = bad_name
            puzzle["valid_guesses"] = [bad_name]
            with self.assertRaises(ValueError):
                validate_name_guess_puzzle(puzzle)
            if JSON_VALIDATOR:
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(puzzle)

    def test_target_not_in_valid_guesses_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["valid_guesses"] = ["AESPA", "STAYC", "LOONA"]
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("must be in valid_guesses", str(ctx.exception))

    def test_valid_guesses_with_wrong_length_word_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["valid_guesses"].append("ITZY")  # 4 letters instead of 5
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("must be an uppercase string matching", str(ctx.exception))

    def test_valid_guesses_with_duplicate_words_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["valid_guesses"].append("TWICE")
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("contains duplicate words", str(ctx.exception))
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_valid_guesses_empty_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["valid_guesses"] = []
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_invalid_target_qid_fails(self):
        for bad_qid in ("12345", "q21480414", "Q012", "Q", "P264"):
            puzzle = sample_name_guess_puzzle()
            puzzle["target"]["id"] = bad_qid
            with self.assertRaises(ValueError):
                validate_name_guess_puzzle(puzzle)
            if JSON_VALIDATOR:
                with self.assertRaises(fastjsonschema.JsonSchemaException):
                    JSON_VALIDATOR(puzzle)

    def test_invalid_target_entity_type_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["target"]["entity_type"] = "album"
        with self.assertRaises(ValueError) as ctx:
            validate_name_guess_puzzle(puzzle)
        self.assertIn("entity_type must be", str(ctx.exception))
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

    def test_missing_or_invalid_evidence_fails(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["target"]["evidence"] = []
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

        bad_ev_puzzle = sample_name_guess_puzzle()
        bad_ev_puzzle["target"]["evidence"] = [
            {
                "fact_base_id": "fb-1",
                "locator": "claims/P264",
                "revision_id": 0,  # must be >= 1
                "source_key": "wikidata",
                "source_url": "https://wikidata.org",
            }
        ]
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(bad_ev_puzzle)

        http_ev_puzzle = sample_name_guess_puzzle()
        http_ev_puzzle["target"]["evidence"] = [
            {
                "fact_base_id": "fb-1",
                "locator": "claims/P264",
                "revision_id": 100,
                "source_key": "wikidata",
                "source_url": "http://wikidata.org",  # must be https
            }
        ]
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(http_ev_puzzle)

    def test_invalid_clues_fail(self):
        puzzle = sample_name_guess_puzzle()
        puzzle["target"]["clues"]["unexpected_key"] = "value"
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle)
        if JSON_VALIDATOR:
            with self.assertRaises(fastjsonschema.JsonSchemaException):
                JSON_VALIDATOR(puzzle)

        puzzle_bad_year = sample_name_guess_puzzle()
        puzzle_bad_year["target"]["clues"]["debut_year"] = 1899
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle_bad_year)

        puzzle_bool_members = sample_name_guess_puzzle()
        puzzle_bool_members["target"]["clues"]["members_count"] = True
        with self.assertRaises(ValueError):
            validate_name_guess_puzzle(puzzle_bool_members)


class TestNormalizeName(unittest.TestCase):
    """Test normalization helper for K-pop names."""

    def test_simple_uppercase_retained(self):
        self.assertEqual(normalize_name("TWICE"), "TWICE")

    def test_lowercase_converted_to_uppercase(self):
        self.assertEqual(normalize_name("aespa"), "AESPA")

    def test_punctuation_and_symbols_removed(self):
        self.assertEqual(normalize_name("(G)I-DLE"), "GIDLE")
        self.assertEqual(normalize_name("f(x)"), "FX")

    def test_spaces_removed(self):
        self.assertEqual(normalize_name("LE SSERAFIM"), "LESSERAFIM")
        self.assertEqual(normalize_name("Red Velvet"), "REDVELVET")
        self.assertEqual(normalize_name("Stray Kids"), "STRAYKIDS")

    def test_accents_and_diacritics_stripped(self):
        self.assertEqual(normalize_name("São Paulo"), "SAOPAULO")
        self.assertEqual(normalize_name("Renée"), "RENEE")
        self.assertEqual(normalize_name("Bébé"), "BEBE")

    def test_digits_removed(self):
        self.assertEqual(normalize_name("2NE1"), "NE")
        self.assertEqual(normalize_name("GOT7"), "GOT")


class TestComputeGuessFeedback(unittest.TestCase):
    """Test positional feedback algorithm with duplicate handling."""

    def test_exact_match(self):
        feedback = compute_guess_feedback("TWICE", "TWICE")
        self.assertEqual(feedback, ["correct", "correct", "correct", "correct", "correct"])

    def test_completely_absent(self):
        feedback = compute_guess_feedback("TWICE", "SHARK")
        self.assertEqual(feedback, ["absent", "absent", "absent", "absent", "absent"])

    def test_all_present_anagram(self):
        feedback = compute_guess_feedback("ALERT", "ALTER")
        self.assertEqual(feedback, ["correct", "correct", "present", "present", "present"])

    def test_duplicate_letter_handling_speed_erase(self):
        # Target: SPEED, Guess: ERASE
        # E at 0 -> present (1 of 2 E's in SPEED)
        # R at 1 -> absent
        # A at 2 -> absent
        # S at 3 -> present (S in SPEED)
        # E at 4 -> present (2nd of 2 E's in SPEED)
        feedback = compute_guess_feedback("SPEED", "ERASE")
        self.assertEqual(feedback, ["present", "absent", "absent", "present", "present"])

    def test_duplicate_letter_handling_apple_puppy(self):
        # Target: APPLE, Guess: PUPPY
        # P at 2 is exact match (correct), consumes 1 'P'
        # P at 0 is present, consumes 2nd 'P'
        # P at 3 is absent (only 2 'P's in APPLE)
        feedback = compute_guess_feedback("APPLE", "PUPPY")
        self.assertEqual(feedback, ["present", "absent", "correct", "absent", "absent"])

    def test_length_mismatch_raises(self):
        with self.assertRaises(ValueError):
            compute_guess_feedback("TWICE", "ITZY")

    def test_lowercase_or_non_alpha_raises(self):
        with self.assertRaises(ValueError):
            compute_guess_feedback("TWICE", "twice")
        with self.assertRaises(ValueError):
            compute_guess_feedback("TWICE", "TW1CE")


class TestGenerateShareSummary(unittest.TestCase):
    """Test text share summary generator."""

    def test_win_summary_standard(self):
        attempts = [
            ["absent", "present", "absent", "absent", "absent"],
            ["correct", "correct", "correct", "correct", "correct"],
        ]
        summary = generate_share_summary("2026-09-18", attempts, won=True, max_attempts=6)
        expected = (
            "K-pop Guess 2026-09-18 2/6\n\n"
            "⬛🟨⬛⬛⬛\n"
            "🟩🟩🟩🟩🟩"
        )
        self.assertEqual(summary, expected)

    def test_loss_summary_standard(self):
        attempts = [
            ["absent", "absent", "absent", "absent", "absent"],
            ["present", "absent", "absent", "absent", "absent"],
            ["correct", "absent", "absent", "absent", "absent"],
            ["correct", "correct", "absent", "absent", "absent"],
            ["correct", "correct", "correct", "absent", "absent"],
            ["correct", "correct", "correct", "correct", "absent"],
        ]
        summary = generate_share_summary("2026-09-18", attempts, won=False, max_attempts=6)
        expected = (
            "K-pop Guess 2026-09-18 X/6\n\n"
            "⬛⬛⬛⬛⬛\n"
            "🟨⬛⬛⬛⬛\n"
            "🟩⬛⬛⬛⬛\n"
            "🟩🟩⬛⬛⬛\n"
            "🟩🟩🟩⬛⬛\n"
            "🟩🟩🟩🟩⬛"
        )
        self.assertEqual(summary, expected)

    def test_high_contrast_summary(self):
        attempts = [
            ["correct", "present", "absent"],
        ]
        summary = generate_share_summary(
            "2026-09-18", attempts, won=True, max_attempts=6, high_contrast=True
        )
        expected = "K-pop Guess 2026-09-18 1/6\n\n🟦🟧⬛"
        self.assertEqual(summary, expected)


class TestWriteNameGuessPuzzleAtomic(unittest.TestCase):
    """Test atomic writing of name guess puzzles."""

    def test_valid_payload_writes_and_returns_bytes(self):
        puzzle = sample_name_guess_puzzle()
        with tempfile.TemporaryDirectory() as tmpdir:
            target_path = Path(tmpdir) / "name-guess.daily.json"
            written_bytes = write_name_guess_puzzle_atomic(target_path, puzzle)
            self.assertTrue(target_path.exists())
            self.assertGreater(len(written_bytes), 0)

            loaded = json.loads(target_path.read_text(encoding="utf-8"))
            self.assertEqual(loaded["puzzle_id"], puzzle["puzzle_id"])

    def test_invalid_payload_fails_and_does_not_create_file(self):
        bad_puzzle = sample_name_guess_puzzle()
        del bad_puzzle["word_length"]
        with tempfile.TemporaryDirectory() as tmpdir:
            target_path = Path(tmpdir) / "invalid.json"
            with self.assertRaises(ValueError):
                write_name_guess_puzzle_atomic(target_path, bad_puzzle)
            self.assertFalse(target_path.exists())


if __name__ == "__main__":
    unittest.main()
