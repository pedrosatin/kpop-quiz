import unittest
from datetime import date

from kpop_scraping.quiz_models import (
    GENERATOR_VERSION,
    DEFAULT_REFERENCE_DATE,
    InsufficientQuestionsError,
    QuizConfig,
    Entity,
    Evidence,
    Fact,
    Draft,
)

class TestQuizModels(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(GENERATOR_VERSION, "quiz-generator-v11")
        self.assertEqual(DEFAULT_REFERENCE_DATE, date(2026, 9, 13))

    def test_insufficient_questions_error(self):
        with self.assertRaises(ValueError):
            raise InsufficientQuestionsError("Not enough questions")

    def test_quiz_config_defaults(self):
        config = QuizConfig(language="en", seed="123")
        self.assertEqual(config.language, "en")
        self.assertEqual(config.seed, "123")
        self.assertIsNone(config.theme)
        self.assertIsNone(config.group_id)
        self.assertEqual(config.play_mode, "standard")
        self.assertIsNone(config.timer_seconds)
        self.assertIsNone(config.decade)

    def test_quiz_config_custom(self):
        config = QuizConfig(
            language="pt-BR",
            seed="abc",
            theme="debut",
            group_id="Q123",
            play_mode="hard",
            timer_seconds=60,
            decade=2010,
        )
        self.assertEqual(config.theme, "debut")
        self.assertEqual(config.group_id, "Q123")
        self.assertEqual(config.play_mode, "hard")
        self.assertEqual(config.timer_seconds, 60)
        self.assertEqual(config.decade, 2010)

    def test_entity_name_identity_person_group(self):
        # Person and group should always return canonical_name
        person = Entity(
            wikidata_id="Q1",
            entity_type="person",
            canonical_name="John Doe",
            names={"en": "John", "pt": "João"},
        )
        self.assertEqual(person.name("en"), "John Doe")
        self.assertEqual(person.name("pt-BR"), "John Doe")

        group = Entity(
            wikidata_id="Q2",
            entity_type="group",
            canonical_name="The Band",
            names={"en": "Band", "pt": "Banda"},
        )
        self.assertEqual(group.name("en"), "The Band")
        self.assertEqual(group.name("pt-BR"), "The Band")

    def test_entity_name_fallback_logic(self):
        # Other entity types should use the language fallback logic
        song = Entity(
            wikidata_id="Q3",
            entity_type="song",
            canonical_name="Original Song Name",
            names={"en": "English Song Name", "pt": "Portuguese Song Name"},
        )

        # When language is pt-BR, preferred is pt, fallback is en
        self.assertEqual(song.name("pt-BR"), "Portuguese Song Name")

        # When language is en, preferred is en, fallback is pt
        self.assertEqual(song.name("en"), "English Song Name")

        # Test missing preferred language
        song_no_pt = Entity(
            wikidata_id="Q3",
            entity_type="song",
            canonical_name="Original Song Name",
            names={"en": "English Song Name"},
        )
        self.assertEqual(song_no_pt.name("pt-BR"), "English Song Name")

        # Test missing preferred and fallback language
        song_no_names = Entity(
            wikidata_id="Q3",
            entity_type="song",
            canonical_name="Original Song Name",
            names={},
        )
        self.assertEqual(song_no_names.name("pt-BR"), "Original Song Name")
        self.assertEqual(song_no_names.name("es"), "Original Song Name")

    def test_entity_identity_names(self):
        entity = Entity(
            wikidata_id="Q4",
            entity_type="person",
            canonical_name="Jane Doe",
            names={"en": "Jane Doe", "pt": "Jane"},
            aliases=("J. Doe", "Jane"),
        )

        # Should deduplicate canonical_name, names.values(), and aliases
        # Order should be preserved based on insertion
        expected = ("Jane Doe", "Jane", "J. Doe")
        self.assertEqual(entity.identity_names(), expected)

    def test_evidence_payload(self):
        evidence = Evidence(
            fact_base_id="fb1",
            source_key="wiki",
            locator="Q123",
            source_url="http://example.com",
            revision_id=456,
        )
        expected = {
            "fact_base_id": "fb1",
            "locator": "Q123",
            "revision_id": 456,
            "source_key": "wiki",
            "source_url": "http://example.com",
        }
        self.assertEqual(evidence.payload(), expected)

    def test_fact_creation(self):
        entity = Entity("Q1", "person", "Name", {})
        evidence = Evidence("fb1", "key", "loc", "url", 1)
        fact = Fact(
            statement_id="s1",
            subject=entity,
            predicate="P1",
            value_entity=None,
            value_time="+2020-01-01T00:00:00Z",
            value_precision=9,
            valid_from=None,
            valid_from_precision=None,
            valid_to=None,
            valid_to_precision=None,
            flags=("flag1",),
            evidence=(evidence,)
        )
        self.assertEqual(fact.statement_id, "s1")
        self.assertEqual(fact.subject, entity)
        self.assertEqual(fact.value_time, "+2020-01-01T00:00:00Z")
        self.assertEqual(fact.flags, ("flag1",))
        self.assertEqual(fact.evidence, (evidence,))

    def test_draft_creation(self):
        evidence = Evidence("fb1", "key", "loc", "url", 1)
        draft = Draft(
            key=("k1", "k2"),
            question_type="qtype",
            theme="theme1",
            difficulty="easy",
            group_ids=("g1",),
            answer=("a1", "a2"),
            alternatives=(("alt1", "alt2"),),
            values={"val": 1},
            evidence=(evidence,),
            fact_base_ids=("fb1",)
        )
        self.assertEqual(draft.key, ("k1", "k2"))
        self.assertEqual(draft.question_type, "qtype")
        self.assertEqual(draft.values, {"val": 1})
        self.assertEqual(draft.evidence, (evidence,))

if __name__ == "__main__":
    unittest.main()
