import copy
import unittest
from datetime import date
from kpop_scraping.quiz_schema import (
    DATASET_SCHEMA_VERSION,
    SESSION_SCHEMA_VERSION,
    QUESTION_TYPES,
    REPORT_SCHEMA_VERSION,
    validate_dataset,
    validate_session,
    validate_report,
    _require,
    _require_hash,
    _require_date,
    _validate_question_clues,
    mode_neutral_question
)

class TestQuizSchema(unittest.TestCase):
    def test_require_valid(self):
        _require(True, "field")

    def test_require_invalid(self):
        with self.assertRaises(ValueError):
            _require(False, "field")

    def test_require_hash_valid(self):
        _require_hash("a" * 64, "field")
        _require_hash("0123456789abcdef" * 4, "field")

    def test_require_hash_invalid(self):
        with self.assertRaises(ValueError):
            _require_hash("short", "field")
        with self.assertRaises(ValueError):
            _require_hash("A" * 64, "field") # Upper case not allowed
        with self.assertRaises(ValueError):
            _require_hash(123, "field")

    def test_require_date_valid(self):
        _require_date("2023-01-01", "field")

    def test_require_date_invalid(self):
        with self.assertRaises(ValueError):
            _require_date("01-01-2023", "field")
        with self.assertRaises(ValueError):
            _require_date("not-a-date", "field")
        with self.assertRaises(ValueError):
            _require_date(123, "field")

    def _valid_question(self):
        return {
            "id": "a" * 64,
            "logical_id": "b" * 64,
            "base_logical_id": "c" * 64,
            "semantic_id": "d" * 64,
            "language": "en",
            "type": "formation_year",
            "play_mode": "standard",
            "challenge_rating": "medium",
            "base_points": 100,
            "hint_cost": 50,
            "theme": "Theme",
            "group_ids": ["g1"],
            "fact_base_ids": ["f1"],
            "clues_available": [],
            "clues_shown": [],
            "prompt": "Prompt",
            "options": [
                {"id": "1" * 64, "label": "L1", "value": "V1", "value_type": "number"},
                {"id": "2" * 64, "label": "L2", "value": "V2", "value_type": "number"},
                {"id": "3" * 64, "label": "L3", "value": "V3", "value_type": "number"},
                {"id": "4" * 64, "label": "L4", "value": "V4", "value_type": "number"}
            ],
            "answer_option_id": "1" * 64,
            "explanation": "Exp",
            "reference_date": "2023-01-01",
            "evidence": [
                {
                    "fact_base_id": "f1",
                    "locator": "loc",
                    "revision_id": 1,
                    "source_key": "wiki",
                    "source_url": "https://example.com"
                }
            ]
        }

    def _valid_dataset(self):
        return {
            "schema_version": DATASET_SCHEMA_VERSION,
            "dataset_version": "e" * 64,
            "generator_version": "v1",
            "template_version": "v1",
            "source_policy_version": "v1",
            "reference_date": "2023-01-01",
            "language_variant_count": 3,
            "languages": ["en"],
            "logical_question_count": 1,
            "questions": [
                self._valid_question(),
                {**self._valid_question(), "id": "1" + "a" * 63, "play_mode": "assisted"},
                {**self._valid_question(), "id": "2" + "a" * 63, "play_mode": "expert"}
            ]
        }

    def test_validate_dataset_valid(self):
        validate_dataset(self._valid_dataset())

    def test_validate_dataset_missing_fields(self):
        dataset = self._valid_dataset()
        del dataset["dataset_version"]
        with self.assertRaises(ValueError):
            validate_dataset(dataset)

    def test_validate_dataset_invalid_schema(self):
        dataset = self._valid_dataset()
        dataset["schema_version"] = "invalid"
        with self.assertRaises(ValueError):
            validate_dataset(dataset)

    def test_validate_dataset_invalid_logical_question_count(self):
        dataset = self._valid_dataset()
        dataset["logical_question_count"] = 2
        with self.assertRaises(ValueError):
            validate_dataset(dataset)

    def _valid_session(self):
        return {
            "schema_version": SESSION_SCHEMA_VERSION,
            "dataset_version": "a" * 64,
            "session_id": "b" * 64,
            "config": {
                "language": "en",
                "seed": "random_seed",
                "theme": "Theme",
                "group_id": "g1",
                "play_mode": "standard",
                "timer_seconds": 60
            },
            "questions": [{**self._valid_question(), "id": str(i) * 64, "logical_id": str(i) * 64, "semantic_id": str(i) * 64} for i in range(10)]
        }

    def test_validate_session_valid(self):
        validate_session(self._valid_session())

    def test_validate_session_missing_fields(self):
        session = self._valid_session()
        del session["dataset_version"]
        with self.assertRaises(ValueError):
            validate_session(session)

    def test_validate_session_invalid_schema(self):
        session = self._valid_session()
        session["schema_version"] = "invalid"
        with self.assertRaises(ValueError):
            validate_session(session)

    def test_validate_session_invalid_config_timer(self):
        session = self._valid_session()
        session["config"]["timer_seconds"] = -1
        with self.assertRaises(ValueError):
            validate_session(session)

    def _valid_report(self):
        return {
            "schema_version": REPORT_SCHEMA_VERSION,
            "dataset_version": "a" * 64,
            "accepted_by_predicate": {},
            "accepted_by_template": {'group_for_record_label': 0, 'formation_year': 0, 'earliest_release': 0, 'member_at_date': 0, 'release_year': 0, 'group_for_member': 0, 'group_for_release': 0, 'record_label_for_group': 0, 'chronological_comparison': 0, 'member_for_group': 0, 'release_for_group': 0, 'birth_date_or_place': 0, 'age_on_date': 0},
            "accepted_by_type": {'birth_date_or_place': 0, 'earliest_release': 0, 'member_at_date': 0, 'release_for_group': 0, 'record_label_for_group': 0, 'age_on_date': 0, 'group_for_record_label': 0, 'group_for_release': 0, 'chronological_comparison': 0, 'formation_year': 0, 'release_year': 0, 'member_for_group': 0, 'group_for_member': 0},
            "accepted_distinct_fact_bases": 0,
            "accepted_logical": 0,
            "clue_coverage": {
                "by_type": {
                    question_type: {"questions": 0, "with_clue": 0}
                    for question_type in QUESTION_TYPES
                },
                "questions": 0,
                "unavailable_by_reason": {},
                "with_clue": 0,
            },
            "clue_eligible_base_questions": 0,
            "language_variants": 0,
            "rejected_by_reason": {},
            "variants_by_play_mode": {"assisted": 0, "standard": 0, "expert": 0},
            "variants_by_language": {"en": 0}
        }

    def test_validate_report_valid(self):
        validate_report(self._valid_report())

    def test_validate_report_missing_fields(self):
        report = self._valid_report()
        del report["dataset_version"]
        with self.assertRaises(ValueError):
            validate_report(report)

    def test_validate_report_invalid_schema(self):
        report = self._valid_report()
        report["schema_version"] = "invalid"
        with self.assertRaises(ValueError):
            validate_report(report)

    def test_validate_report_clue_coverage_must_match_totals(self):
        report = self._valid_report()
        report["clue_coverage"]["by_type"]["formation_year"]["with_clue"] = 1
        with self.assertRaises(ValueError):
            validate_report(report)

    def test_clue_may_cite_a_fact_outside_the_question_when_it_has_evidence(self):
        question = self._valid_question()
        clue = {
            "evidence": [{
                "fact_base_id": "other-fact", "locator": "claim:other-fact", "revision_id": 7,
                "source_key": "wikidata", "source_url": "https://www.wikidata.org/wiki/Q9",
            }],
            "fact_base_ids": ["other-fact"],
            "id": "c" * 64,
            "text": "clue",
            "type": "decade",
        }
        question["clues_available"] = [clue]
        _validate_question_clues(question)
        uncovered = copy.deepcopy(question)
        uncovered["clues_available"][0]["fact_base_ids"] = ["other-fact", "third-fact"]
        with self.assertRaises(ValueError):
            _validate_question_clues(uncovered)
        unsourced = copy.deepcopy(question)
        unsourced["clues_available"][0]["evidence"] = []
        with self.assertRaises(ValueError):
            _validate_question_clues(unsourced)

    def test_validate_report_invalid_counts(self):
        report = self._valid_report()
        report["clue_eligible_base_questions"] = 1 # > accepted_logical
        with self.assertRaises(ValueError):
            validate_report(report)

    def test_mode_neutral_question(self):
        question = self._valid_question()
        question["play_mode"] = "expert"
        question["base_points"] = 200

        standard_question = self._valid_question()
        neutral = mode_neutral_question(question, standard_question)

        self.assertNotIn("play_mode", neutral)
        self.assertNotIn("base_points", neutral)
        self.assertEqual(neutral["language"], "en")

    def test_mode_neutral_option_person(self):
        assisted_question = self._valid_question()
        assisted_question["play_mode"] = "assisted"

        # Change option 1 to be a person with assisted label
        assisted_question["options"][0]["value_type"] = "person"
        assisted_question["options"][0]["label"] = "Standard Label (Hint)"

        standard_question = self._valid_question()
        standard_question["options"][0]["value_type"] = "person"
        standard_question["options"][0]["label"] = "Standard Label"

        neutral = mode_neutral_question(assisted_question, standard_question)
        self.assertEqual(neutral["options"][0]["label"], "Standard Label")
