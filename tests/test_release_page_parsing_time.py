"""Time limits for the release lead checks on text any Wikipedia editor can save.

Each timed input is the shape that made the earlier loop or pattern run for
seconds to minutes, at a fixed size. The comment of each test gives the CPU time
that code took on a laptop with Python 3.14. The current code takes under
0.25 s on each of them, so the one-second limit is four times the slowest.
The other tests pin the output the same rules must keep on ordinary text.
"""

import time
import unittest

from kpop_scraping.entities import GREGORIAN_CALENDAR, TimeValue
from kpop_scraping.evidence import (
    WikipediaPage,
    _sentences,
    release_date_evidence,
    release_performer_evidence,
    text_evidence,
)

LIMIT_SECONDS = 1.0
DATE = TimeValue("2020-01-02", 11, GREGORIAN_CALENDAR)
DATE_SENTENCE = "It was released by Label One on January 2, 2020."


def page(extract):
    return WikipediaPage(1, "en", 1, 1, extract, "Alpha")


def locator(evidence):
    return evidence.locator if evidence else None


def span_locator(extract, text, start=0):
    begin = extract.index(text, start)
    return f"wikipedia:en:pageid=1:revid=1#extract[{begin}:{begin + len(text)}]"


def name_contexts(name):
    """Leads that hold ``name`` in each place outside the artist credit."""
    return (
        f"Alpha is the first EP by the duo Foo, a sub-unit of {name}.",
        f"Alpha is the first EP by the duo Foo, a sub-unit of Bar consisting of members {name}, Taeyeon, and Tiffany.",
        f"Alpha is the first EP by the duo Foo, a sub-unit of Bar consisting of members Taeyeon, {name}, and Tiffany.",
        f"Alpha is the first EP by the duo Foo, a sub-unit of Bar consisting of members Taeyeon, Tiffany, and {name}.",
        f"Alpha is a song by the group Twice from the reissue of their first studio album, {name} (2011).",
        "Alpha is the first EP by the band Foo. It is the second release of the band "
        f"since the departure of {name} on January 1, 2019.",
    )


class TimeLimitTest(unittest.TestCase):
    def timed(self, call):
        """Run ``call`` and fail when it uses more CPU time than the limit."""
        start = time.process_time()
        result = call()
        self.assertLess(time.process_time() - start, LIMIT_SECONDS)
        return result

    def test_many_date_sentences_in_a_row(self):
        # 8.3 s before: each date sentence split the whole text before it again.
        extract = "Alpha is a song recorded by Group One." + f" {DATE_SENTENCE}" * 2000
        found = self.timed(
            lambda: text_evidence("released_on", page(extract), ["Alpha"], [], DATE)
        )
        self.assertIsNone(found)

    def test_many_by_triggers_in_one_sentence(self):
        # 150 s before: each "by" searched the sentence up to it for "with".
        extract = "Alpha is a single" + " by" * 50000 + "."
        found = self.timed(
            lambda: text_evidence("performed_by", page(extract), ["Alpha"], ["Group One"])
        )
        self.assertIsNone(found)

    def test_many_name_words_that_start_with_a_parenthesis(self):
        # 5.7 s before: each "(Ab" could end the name or open its parenthesis.
        extract = f"Alpha is a single by group {'Ab (' * 5000}x. {DATE_SENTENCE}"
        found = self.timed(
            lambda: text_evidence("released_on", page(extract), ["Alpha"], [], DATE)
        )
        self.assertIsNone(found)

    def test_parentheses_in_names_outside_the_artist_credit(self):
        # Fast before too, under 0.1 s each. Any word of a name there may start
        # with a parenthesis, which must not bring back the cost of the artist's.
        for unit, count in (("Ab (", 50000), ("Ab (Cd (", 25000), ("((", 50000), (")(", 50000)):
            name = f"Ab {unit * count}x"
            for lead in name_contexts(name):
                extract = f"{lead} {DATE_SENTENCE}"
                with self.subTest(unit=unit, lead=lead[:60]):
                    found = self.timed(
                        lambda: text_evidence("released_on", page(extract), ["Alpha"], [], DATE)
                    )
                    self.assertIsNone(found)


class SentenceSpanTest(unittest.TestCase):
    def test_spans_before_a_sentence_are_those_of_its_prefix(self):
        # The date rule once split the text before the date sentence again.
        # The spans of the whole text give the same sentences, apart from the
        # whitespace that ended the prefix.
        separators = (" ", "  ", " \t", "\u00a0 ", "\n", "\n\n", " \n", "  \n ", ". ")
        pieces = (
            "Alpha is a single by Group One.",
            '"Alpha" is a song.',
            "It was released by Mr. Kim in the U.S.",
            "It is the 2nd one!",
            "(Alpha) was recorded?",
            "St. Kim sang it.",
        )
        for separator in separators:
            text = separator.join(pieces) + separator.rstrip()
            spans = _sentences(text)
            with self.subTest(separator=separator):
                self.assertGreater(len(spans), 1)
                for index, (start, _) in enumerate(spans):
                    prefix = _sentences(text[:start])
                    self.assertEqual(prefix[:-1], spans[: index - 1] if index else [])
                    if index:
                        begin, end = prefix[-1]
                        self.assertEqual(begin, spans[index - 1][0])
                        self.assertEqual(text[begin:end].rstrip(), text[slice(*spans[index - 1])])

    def test_date_after_a_lead_that_ends_in_spaces(self):
        for separator in (" ", "   ", " \n", "  \n\n", "\n"):
            extract = f"Alpha is the first EP by the group Group One.{separator}{DATE_SENTENCE}"
            with self.subTest(separator=separator):
                found = release_date_evidence(page(extract), DATE, ("Alpha",))
                self.assertEqual(locator(found), span_locator(extract, "January 2, 2020"))


class PerformerTriggerTest(unittest.TestCase):
    def performer(self, extract, name):
        peers = ("Group One", "Group Two")
        return locator(release_performer_evidence(page(extract), (name,), ("Alpha",), peers))

    def test_recorded_by_is_still_accepted(self):
        extract = "Alpha is a single recorded by South Korean girl group Group One."
        self.assertEqual(self.performer(extract, "Group One"), span_locator(extract, "Group One"))

    def test_guest_word_after_the_credit_keeps_it(self):
        extract = "Alpha is a single by Group One, with Group Two."
        self.assertEqual(self.performer(extract, "Group One"), span_locator(extract, "Group One"))
        self.assertIsNone(self.performer(extract, "Group Two"))

    def test_guest_word_before_the_credit_refuses_it(self):
        for guest in ("with", "including", "featuring", "With"):
            extract = f"Alpha is an album {guest} Group Two, a single by Group One."
            with self.subTest(guest=guest):
                self.assertIsNone(self.performer(extract, "Group One"))

    def test_guest_word_between_two_credits(self):
        extract = "Alpha is a single by Group One, featuring a single by Group Two."
        self.assertEqual(self.performer(extract, "Group One"), span_locator(extract, "Group One"))
        self.assertIsNone(self.performer(extract, "Group Two"))


class ReleaseNameTest(unittest.TestCase):
    def date(self, lead):
        extract = f"{lead} {DATE_SENTENCE}"
        return extract, locator(release_date_evidence(page(extract), DATE, ("Alpha",)))

    def test_names_with_a_parenthesis_still_count(self):
        for lead in (
            "Alpha is the debut single album by the South Korean girl group (G)I-dle.",
            "Alpha is the first EP by the band Day6 (Even of Day).",
            "Alpha is the first EP by the band Day6 (Even of Day), a sub-unit of the band Day6.",
        ):
            with self.subTest(lead=lead):
                extract, found = self.date(lead)
                self.assertEqual(found, span_locator(extract, "January 2, 2020"))

    def test_any_name_word_outside_the_artist_credit_may_start_with_a_parenthesis(self):
        # Only the artist credit has another name in parentheses after it, so
        # these places keep the names they read before.
        for name in (
            "WJSN (Cosmic Girls)",
            "Sol (Taeyang)",
            "Pinocchio (Danger)",
            "Jae (Park Jae-hyung)",
            # "Cd" would read as the CD format, so the names avoid it.
            "Foo (Ab",
            "Foo (Ab (Gh))",
            "Foo (Ab) Gh",
            "Foo (Ab) (Gh)",
        ):
            for lead in name_contexts(name):
                with self.subTest(lead=lead):
                    extract, found = self.date(lead)
                    self.assertEqual(found, span_locator(extract, "January 2, 2020"))

    def test_review_sentences_outside_the_artist_credit(self):
        for lead in (
            "Alpha is the first EP by the duo Foo, a sub-unit of WJSN (Cosmic Girls).",
            "Alpha is the first EP by the duo Foo, a sub-unit of Girls' Generation "
            "consisting of members Taeyeon, Sol (Taeyang), and Tiffany.",
            "Alpha is a song by the group Twice from the reissue of their first studio "
            "album, Pinocchio (Danger) (2011).",
            "Alpha is a song by the group Twice from the reissue of their first studio "
            "album, Exodus (2015).",
            "Alpha is the first EP by the band Day6. It is the second release of the band "
            "since the departure of Jae (Park Jae-hyung) on January 1, 2019.",
        ):
            with self.subTest(lead=lead):
                extract, found = self.date(lead)
                self.assertEqual(found, span_locator(extract, "January 2, 2020"))

    def test_later_name_word_may_not_start_with_a_parenthesis(self):
        # Only one parenthesis after the name reads as its other name.
        for lead in (
            "Alpha is the first EP by the group Foo (Bar) Baz.",
            "Alpha is the first EP by the group Cube (G)I-dle.",
            "Alpha is the first EP by the band Day6 (Even of Day) (Xy).",
        ):
            with self.subTest(lead=lead):
                self.assertIsNone(self.date(lead)[1])


if __name__ == "__main__":
    unittest.main()
