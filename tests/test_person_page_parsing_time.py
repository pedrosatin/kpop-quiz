"""Time limits for the person infobox check on text any Wikipedia editor can save.

Each timed input is the shape that made the earlier patterns run for seconds,
at a fixed size. The comment of each test gives the CPU time that code took on
a loaded laptop with Python 3.14; the same input took about four times longer
under heavier load. The current code takes under 0.02 s on each of them, so the
one-second limit leaves a wide margin for a slow machine.
The other tests pin the cut the same rules must keep on ordinary text.
"""

import time
import unittest

from kpop_scraping.entities import GREGORIAN_CALENDAR, TimeValue
from kpop_scraping.evidence import WikipediaPage
from kpop_scraping.person_evidence import (
    VALUE_AMBIGUOUS,
    VALUE_DIFFERS,
    _stated_date,
    _without_trailing_notes,
    person_infobox_check,
)

LIMIT_SECONDS = 1.0
PERSON = "Q1"


def person_page(field, value):
    wikitext = "{{Infobox person\n| name = Someone\n| " + field + " = " + value + "\n}}\n"
    return WikipediaPage(7, "en", 10, 20, "", "Someone", wikitext, PERSON, False)


class TimeLimitTest(unittest.TestCase):
    def timed(self, call):
        """Run ``call`` and fail when it uses more CPU time than the limit."""
        start = time.process_time()
        result = call()
        self.assertLess(time.process_time() - start, LIMIT_SECONDS)
        return result

    def born_in(self, value):
        page = person_page("birth_place", value)
        check = self.timed(
            lambda: person_infobox_check("born_in", page, PERSON, None, ["Seoul"])
        )
        self.assertEqual(check.rejection_reason, VALUE_DIFFERS)
        start, end = (int(n) for n in check.observed.locator.rsplit("[", 1)[1][:-1].split(":"))
        self.assertEqual(page.wikitext[start:end], value)

    def test_references_before_text(self):
        # More than 300 s before, when it was stopped; 24 references took 10 s,
        # and each two more multiplied that by about 4. A reference could
        # close at any later "</ref>".
        self.born_in("Busan" + "<ref>a</ref>" * 30 + " x, [[Daegu]]")

    def test_comments_before_text(self):
        # More than 150 s before, when it was stopped; 22 comments took 2.3 s.
        # A comment could close at any later "-->".
        self.born_in("Busan" + "<!--a-->" * 30 + " x, [[Daegu]]")

    def test_self_closing_references_before_a_closing_tag(self):
        # 9.2 s before: each "<ref name=a/>" could also open a reference.
        self.born_in("Busan" + "<ref name=a/>" * 800 + "</ref> x, [[Daegu]]")

    def test_spaces_left_by_a_long_reference(self):
        # 5.1 s before, and 1.3 s with half the spaces: the pattern of the
        # note in parentheses was tried at each of the spaces that the
        # reference became, and each try read them all.
        value = "{{birth date|1993|1|12}}<ref>" + "a" * 64000 + "</ref> x"
        check = self.timed(
            lambda: person_infobox_check(
                "born_on",
                person_page("birth_date", value),
                PERSON,
                TimeValue("1993-01-12", 11, GREGORIAN_CALENDAR),
            )
        )
        self.assertEqual(check.rejection_reason, VALUE_AMBIGUOUS)


class TrailingNotesTest(unittest.TestCase):
    def cut(self, text):
        start, end = _without_trailing_notes(text, 0, len(text))
        return text[start:end]

    def test_notes_at_the_end_are_cut(self):
        cases = {
            "[[Seoul]]<ref>a</ref> <!-- b --><ref name=c/>": "[[Seoul]]",
            "[[Seoul]]<REF name=\"a/b\">x</Ref >\n": "[[Seoul]]",
            "[[Seoul]] <ref>a <!-- b --> c</ref>": "[[Seoul]]",
            "[[Seoul]]<ref>a</ref> ": "[[Seoul]]",
            "<ref>a</ref>": "",
            # A note may close at a later tag, past the text between two notes.
            "Busan<ref>a</ref>, Korea<ref>b</ref>": "Busan",
            "Busan<!-- a -->, Korea<!-- b -->": "Busan",
            "Busan<ref name=a/>, Korea<ref>b</ref>": "Busan",
        }
        for text, kept in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.cut(text), kept)

    def test_text_or_an_open_note_at_the_end_stays(self):
        for text in (
            "[[Seoul]]<ref>a</ref> x",
            "[[Seoul]]<ref>a",
            "[[Seoul]]<!-->",
            "[[Seoul]]<ref name=a / x>",
            "[[Seoul]]<ref>a</ref></ref> x",
            "[[Seoul]] </ref>",
        ):
            with self.subTest(text=text):
                self.assertEqual(self.cut(text), text)


class TrailingParenthesisTest(unittest.TestCase):
    def test_only_the_last_parenthesis_is_dropped(self):
        cases = {
            "January 12, 1993 (age 33)": (1993, 1, 12),
            "January 12, 1993 (age 33)\n ": (1993, 1, 12),
            "{{birth date|1993|1|12}}<ref>x</ref> (age 33)": (1993, 1, 12),
            "January 12, 1993 (a) (b)": None,
            "January 12, 1993 (age (33))": None,
            "January 12, 1993 (age 33": None,
            "January 12, 1993 (age 33) x": None,
        }
        for text, stated in cases.items():
            with self.subTest(text=text):
                self.assertEqual(_stated_date(text, 0, len(text)), stated)


if __name__ == "__main__":
    unittest.main()
