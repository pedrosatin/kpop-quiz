import unittest
import re
from kpop_scraping.evidence import _alternation, _sentences, assess_references
from kpop_scraping.entities import Statement, Reference

class TestEvidence(unittest.TestCase):
    def test_alternation_escapes_and_joins(self):
        names = ["A", "B(C)", "D.E"]
        pattern = _alternation(names)
        self.assertEqual(pattern, r"A|B\(C\)|D\.E")

    def test_alternation_empty(self):
        self.assertEqual(_alternation([]), r"(?!)")
        self.assertEqual(_alternation(["", " "]), r"\ ")

    def test_alternation_none_ignored(self):
        self.assertEqual(_alternation(["A", "", "B"]), r"A|B")

    def test_sentences_split_on_period(self):
        text = 'Hello world. This is a test. Another sentence.'
        spans = _sentences(text)
        self.assertEqual(len(spans), 3)
        self.assertEqual(text[spans[0][0]:spans[0][1]], 'Hello world.')
        self.assertEqual(text[spans[1][0]:spans[1][1]], 'This is a test.')
        self.assertEqual(text[spans[2][0]:spans[2][1]], 'Another sentence.')

    def test_sentences_split_on_newline(self):
        text = 'Line one.\nLine two\n\nLine three.'
        spans = _sentences(text)
        self.assertEqual(len(spans), 3)
        self.assertEqual(text[spans[0][0]:spans[0][1]], 'Line one.')
        self.assertEqual(text[spans[1][0]:spans[1][1]], 'Line two')
        self.assertEqual(text[spans[2][0]:spans[2][1]], 'Line three.')

    def test_sentences_ignores_abbreviations(self):
        text = 'Jun. K is a member. The U.S. is a country.'
        spans = _sentences(text)
        self.assertEqual(len(spans), 2)
        self.assertEqual(text[spans[0][0]:spans[0][1]], 'Jun. K is a member.')
        self.assertEqual(text[spans[1][0]:spans[1][1]], 'The U.S. is a country.')

    def test_sentences_ignores_other_abbreviations(self):
        text = 'Prof. Smith went to Washington D.C. today. Mr. Jones went to New York.'
        spans = _sentences(text)
        self.assertEqual(len(spans), 2)
        self.assertEqual(text[spans[0][0]:spans[0][1]], 'Prof. Smith went to Washington D.C. today.')
        self.assertEqual(text[spans[1][0]:spans[1][1]], 'Mr. Jones went to New York.')

    def test_sentences_ignores_empty(self):
        text = '   \n  \n '
        spans = _sentences(text)
        self.assertEqual(len(spans), 0)

class TestAssessReferences(unittest.TestCase):
    def test_reliable_source(self):
        ref1 = Reference(
            hash="hash1",
            properties=("P854",),
            source_keys=("domain:jype.com",)
        )
        statement = Statement(
            statement_id="Q1$123",
            property_id="P1",
            rank="normal",
            snaktype="value",
            raw_value="test",
            item_id=None,
            time=None,
            value_error=None,
            start_times=(),
            end_times=(),
            qualifiers={},
            references=(ref1,)
        )
        assessment = assess_references(statement)
        self.assertIsNone(assessment.rejection_reason)
        self.assertEqual(len(assessment.evidence), 1)
        self.assertEqual(assessment.evidence[0].evidence_type, 'wikidata_reference')
        self.assertEqual(assessment.evidence[0].source_key, 'domain:jype.com')

    def test_unreviewed_source(self):
        ref1 = Reference(
            hash="hash1",
            properties=("P854",),
            source_keys=("https://www.soompi.com/article/123",)
        )
        statement = Statement(
            statement_id="Q1$123",
            property_id="P1",
            rank="normal",
            snaktype="value",
            raw_value="test",
            item_id=None,
            time=None,
            value_error=None,
            start_times=(),
            end_times=(),
            qualifiers={},
            references=(ref1,)
        )
        assessment = assess_references(statement)
        self.assertEqual(assessment.rejection_reason, 'unreviewed_reference_source')
        self.assertEqual(len(assessment.evidence), 0)

    def test_unreliable_source(self):
        ref1 = Reference(
            hash="hash1",
            properties=("P854",),
            source_keys=("domain:imdb.com",)
        )
        statement = Statement(
            statement_id="Q1$123",
            property_id="P1",
            rank="normal",
            snaktype="value",
            raw_value="test",
            item_id=None,
            time=None,
            value_error=None,
            start_times=(),
            end_times=(),
            qualifiers={},
            references=(ref1,)
        )
        assessment = assess_references(statement)
        self.assertEqual(assessment.rejection_reason, 'unreliable_reference_source')
        self.assertEqual(len(assessment.evidence), 0)

    def test_no_url(self):
        ref1 = Reference(
            hash="hash1",
            properties=("P123",),
            source_keys=()
        )
        statement = Statement(
            statement_id="Q1$123",
            property_id="P1",
            rank="normal",
            snaktype="value",
            raw_value="test",
            item_id=None,
            time=None,
            value_error=None,
            start_times=(),
            end_times=(),
            qualifiers={},
            references=(ref1,)
        )
        assessment = assess_references(statement)
        self.assertIsNone(assessment.rejection_reason)
        self.assertEqual(len(assessment.evidence), 0)

if __name__ == "__main__":
    unittest.main()
