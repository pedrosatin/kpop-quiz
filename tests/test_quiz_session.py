import unittest
from typing import Any
from kpop_scraping.quiz_session import create_session, _filter_by_group_relevance, _session_question
from kpop_scraping.quiz_models import QuizConfig, InsufficientQuestionsError
from kpop_scraping.quiz_schema import DATASET_SCHEMA_VERSION, SESSION_SCHEMA_VERSION

class TestQuizSession(unittest.TestCase):
    def setUp(self):
        # A helper method to create a valid base question
        self.base_question = {
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
            "theme": "debut",
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

    def _generate_dataset(self, num_questions=15, **kwargs):
        dataset = {
            "schema_version": DATASET_SCHEMA_VERSION,
            "dataset_version": "e" * 64,
            "generator_version": "v1",
            "template_version": "v1",
            "source_policy_version": "v1",
            "reference_date": "2023-01-01",
            "language_variant_count": num_questions * 3,
            "languages": ["en"],
            "logical_question_count": num_questions,
            "questions": []
        }
        for i in range(num_questions):
            for j, mode in enumerate(["standard", "assisted", "expert"]):
                q = self.base_question.copy()
                q.update(kwargs)
                q["id"] = f"{(i*3+j):064d}"
                q["logical_id"] = f"{i:064d}"
                q["base_logical_id"] = f"{i:064d}"
                q["semantic_id"] = f"{i:064d}"
                q["play_mode"] = mode
                if "decades" in kwargs:
                    q["decades"] = sorted(set(kwargs["decades"]))
                dataset["questions"].append(q)
        return dataset

    def test_create_session_success(self):
        dataset = self._generate_dataset()
        config = QuizConfig(language="en", seed="seed")

        session = create_session(dataset, config)
        self.assertEqual(session["schema_version"], SESSION_SCHEMA_VERSION)
        self.assertEqual(session["dataset_version"], dataset["dataset_version"])
        self.assertEqual(len(session["questions"]), 10)

    def test_create_session_unsupported_language(self):
        dataset = self._generate_dataset()
        config = QuizConfig(language="fr", seed="seed")
        with self.assertRaisesRegex(ValueError, "unsupported session language"):
            create_session(dataset, config)

    def test_create_session_unsupported_play_mode(self):
        dataset = self._generate_dataset()
        config = QuizConfig(language="en", seed="seed", play_mode="invalid")
        with self.assertRaisesRegex(ValueError, "unsupported play mode"):
            create_session(dataset, config)

    def test_create_session_invalid_timer(self):
        dataset = self._generate_dataset()
        config = QuizConfig(language="en", seed="seed", timer_seconds=0)
        with self.assertRaisesRegex(ValueError, "timer_seconds must be greater than zero"):
            create_session(dataset, config)

    def test_create_session_unsupported_decade(self):
        dataset = self._generate_dataset()
        config = QuizConfig(language="en", seed="seed", decade=1980)
        with self.assertRaisesRegex(ValueError, "unsupported decade"):
            create_session(dataset, config)

    def test_create_session_insufficient_questions(self):
        dataset = self._generate_dataset(num_questions=5)
        config = QuizConfig(language="en", seed="seed")
        with self.assertRaisesRegex(InsufficientQuestionsError, "filters matched 5 questions"):
            create_session(dataset, config)

    def test_create_session_filtering_theme(self):
        dataset = self._generate_dataset(num_questions=15, theme="debut")
        # Change theme of the first logical question (all its modes)
        for i in range(3):
            dataset["questions"][i]["theme"] = "other"
        config = QuizConfig(language="en", seed="seed", theme="debut")

        session = create_session(dataset, config)
        for q in session["questions"]:
            self.assertEqual(q["theme"], "debut")

    def test_create_session_filtering_group(self):
        dataset = self._generate_dataset(num_questions=15, group_ids=["g2"])
        for i in range(3):
            dataset["questions"][i]["group_ids"] = ["g1"]
        config = QuizConfig(language="en", seed="seed", group_id="g2")

        session = create_session(dataset, config)
        for q in session["questions"]:
            self.assertIn("g2", q["group_ids"])

    def test_create_session_filtering_decade(self):
        dataset = self._generate_dataset(num_questions=15, decades=[2000, 2010])
        for i in range(3):
            dataset["questions"][i]["decades"] = [1990]
        config = QuizConfig(language="en", seed="seed", decade=2010)

        session = create_session(dataset, config)
        for q in session["questions"]:
            self.assertIn(2010, q.get("decades", []))

    def test_filter_by_group_relevance_standard(self):
        questions = [{"group_relevance_score": 1000}, {"group_relevance_score": 5000}]
        res = _filter_by_group_relevance(questions, "standard")
        self.assertEqual(res, questions)

    def test_filter_by_group_relevance_assisted(self):
        # ASSISTED_MIN_SCORE is 6667
        questions = [
            {"group_ids": ["g1"], "group_relevance_score": 9000}, # >= 6667 (keeps)
            {"group_ids": ["g2"], "group_relevance_score": 5000}, # < 6667 (removes)
        ]
        res = _filter_by_group_relevance(questions, "assisted")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["group_relevance_score"], 9000)

    def test_filter_by_group_relevance_expert(self):
        # EXPERT_MAX_SCORE is 3333
        questions = [
            {"group_ids": ["g1"], "group_relevance_score": 2000}, # <= 3333 (keeps)
            {"group_ids": ["g2"], "group_relevance_score": 5000}, # > 3333 (removes)
        ]
        res = _filter_by_group_relevance(questions, "expert")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["group_relevance_score"], 2000)

    def test_filter_by_group_relevance_missing_score_fallback(self):
        # If any question with a group_ids doesn't have a score, don't filter
        questions = [
            {"group_ids": ["g1"], "group_relevance_score": 2000},
            {"group_ids": ["g2"], "group_relevance_score": None}, # missing score
        ]
        res = _filter_by_group_relevance(questions, "expert")
        self.assertEqual(len(res), 2)

    def test_session_question_options_shuffled(self):
        q = self.base_question.copy()
        q["options"] = [
            {"id": "opt1"}, {"id": "opt2"}, {"id": "opt3"}, {"id": "opt4"}
        ]

        # Test with a specific seed that causes a different order
        seed = "test_seed"
        res1 = _session_question(q, seed)

        # same seed yields same order
        res2 = _session_question(q, seed)

        self.assertEqual(res1["options"], res2["options"])

        # Different seed yields different order (highly probable)
        res3 = _session_question(q, "another_seed")
        self.assertNotEqual(res1["options"], res3["options"])

if __name__ == '__main__':
    unittest.main()
