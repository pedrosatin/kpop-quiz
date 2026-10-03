import json
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.lyric_hints import (
    ngrams,
    review_approves,
    three_gram_overlaps,
    validate_hint,
    validate_hint_review,
    word_tokens,
    main,
)

LYRICS = "neon lights paint the city blue tonight we run forever"
OTHER = "quiet morning coffee and an empty street"


def make_record(**overrides):
    record = {
        "hint": "faixa dançante sobre correr a noite na cidade",
        "references_checked": [LYRICS],
        "exact_search_hits": 0,
        "three_gram_overlaps": [],
        "second_reader": "ana",
        "editor": "bia",
        "reviewed_at": "2026-10-03",
        "approved": True,
    }
    record.update(overrides)
    return record


class NgramTest(unittest.TestCase):
    def test_tokens_normalize_case_and_punctuation(self):
        self.assertEqual(word_tokens("Olá, MUNDO!"), ("ola", "mundo"))

    def test_short_input_has_no_trigrams(self):
        self.assertEqual(ngrams(("a", "b")), set())

    def test_overlaps_found_across_case_and_punctuation(self):
        overlaps = three_gram_overlaps("Tonight, we RUN forever!", LYRICS)
        self.assertIn("tonight we run", overlaps)
        self.assertIn("we run forever", overlaps)

    def test_paraphrase_has_no_overlaps(self):
        self.assertEqual(
            three_gram_overlaps("faixa dançante sobre correr a noite", LYRICS), []
        )

    def test_invalid_width_rejected(self):
        with self.assertRaises(ValueError):
            ngrams(("a", "b", "c"), 0)


class HintValidationTest(unittest.TestCase):
    def test_valid_hint_passes(self):
        validate_hint("faixa dançante sobre correr a noite na cidade", [LYRICS, OTHER])

    def test_empty_hint_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint("   ", [LYRICS])

    def test_long_hint_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint("x" * 141, [LYRICS])

    def test_two_sentences_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint("Primeira frase. Segunda frase.", [LYRICS])

    def test_missing_references_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint("faixa dançante sobre a noite", [])

    def test_copied_span_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint("we run forever tonight", [LYRICS])

    def test_cli_check_passes(self):
        self.assertEqual(
            main(["check", "--hint", "faixa sobre a cidade", "--reference", OTHER]), 0
        )


class HintReviewTest(unittest.TestCase):
    def test_approving_review_passes(self):
        validate_hint_review(make_record())
        self.assertTrue(review_approves(make_record()))

    def test_missing_field_rejected(self):
        record = make_record()
        del record["second_reader"]
        with self.assertRaises(ValueError):
            validate_hint_review(record)

    def test_search_hits_block_approval(self):
        record = make_record(exact_search_hits=2)
        validate_hint_review(record)
        self.assertFalse(review_approves(record))

    def test_overlaps_block_approval(self):
        record = make_record(three_gram_overlaps=["run forever tonight"])
        validate_hint_review(record)
        self.assertFalse(review_approves(record))

    def test_unapproved_flag_blocks_approval(self):
        self.assertFalse(review_approves(make_record(approved=False)))

    def test_bad_date_rejected(self):
        with self.assertRaises(ValueError):
            validate_hint_review(make_record(reviewed_at="03/10/2026"))

    def test_cli_review_reports_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "review.json"
            path.write_text(json.dumps(make_record()))
            self.assertEqual(main(["review", "--record", str(path)]), 0)


if __name__ == "__main__":
    unittest.main()
