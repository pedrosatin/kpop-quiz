"""Time limits for the group page parsers on text any Wikipedia editor can save.

Each timed input is the shape that made the earlier pattern or loop run for
seconds, at a fixed size. The comment of each test gives the CPU time that code
took on a laptop with Python 3.14; the current code takes at most a few
hundredths of a second, so the one-second limit holds on a slow runner too.
The other tests pin the output the same rules must keep on ordinary text.
"""

import time
import unittest

from kpop_scraping.evidence import (
    WikipediaPage,
    _clean_boundaries,
    _sentences,
    text_evidence,
)
from kpop_scraping.infobox import (
    _strip_templates,
    field_items,
    first_infobox_fields,
    infobox_fields,
)

LIMIT_SECONDS = 1.0
GROUP = "Testgroup"
PERSON_TYPES = frozenset({"person", "musical artist"})


def page(extract=f"{GROUP} is a band.", wikitext=""):
    return WikipediaPage(1, "en", 1, 1, extract, GROUP, wikitext)


def locator(evidence):
    return evidence.locator if evidence else None


class TimeLimitTest(unittest.TestCase):
    def timed(self, call):
        """Run ``call`` and fail when it uses more CPU time than the limit.

        CPU time leaves out the wait for a busy machine, which a backtracking
        pattern does not need in order to be slow.
        """
        start = time.process_time()
        result = call()
        self.assertLess(time.process_time() - start, LIMIT_SECONDS)
        return result

    def test_and_chain_that_is_not_a_genre_list(self):
        # 8.8 s before: every "and" could be a word of an item or a separator.
        words = ["pop", "rock", "soul", "funk", "jazz", "disco", "house", "trap"]
        chain = " and ".join(words[index % len(words)] for index in range(32))
        extract = (
            f"{GROUP} is a South Korean band. {GROUP} draws on genres including "
            f"{chain} music later influenced by K-pop."
        )
        self.assertEqual(len(extract), 390)
        found = self.timed(lambda: text_evidence("genre", page(extract), [GROUP], ["K-pop"]))
        self.assertIsNone(found)

    def test_whitespace_before_a_template_name(self):
        # 3.8 s before: the name and the spaces around it shared the whitespace.
        wikitext = (
            "{{Infobox musical artist\n| name = Testgroup\n| current_members = {{"
            + "\n" * 800
            + "Dummy Person{{efn|note}}}}\n}}\n"
        )
        found = self.timed(
            lambda: text_evidence("has_member", page(wikitext=wikitext), [GROUP], ["Dummyname"])
        )
        self.assertIsNone(found)

    def test_spaces_after_an_infobox_opening(self):
        # 6.7 s before, for the same reason as the template name.
        wikitext = "{{Infobox" + " " * 1200 + "x"
        self.assertEqual(self.timed(lambda: first_infobox_fields(wikitext, PERSON_TYPES)), {})

    def test_abbreviations_in_a_row(self):
        # 5.7 s before: each abbreviation searched the sentence from its start.
        extract = "Mr. A " * 4000
        spans = self.timed(lambda: _sentences(extract))
        self.assertEqual(spans, [(0, len(extract))])

    def test_long_capitalized_word_before_a_name(self):
        # 3.3 s before: each capital letter read the rest of the word again.
        extract = f"{GROUP} is a band. " + "A" * 16000 + f", Dummyname left {GROUP}."
        found = self.timed(
            lambda: text_evidence("has_member", page(extract), [GROUP], ["Dummyname"])
        )
        self.assertEqual(locator(found), "wikipedia:en:pageid=1:revid=1#extract[16023:16032]")

    def test_nested_templates_in_an_infobox_item(self):
        # 5.1 s before: each pass over the item removed one level of nesting.
        depth = 16000
        wikitext = (
            "{{Infobox musical artist\n| current_members = "
            + "{{" * depth
            + "}}" * depth
            + "\n}}"
        )
        items = self.timed(
            lambda: field_items(
                wikitext, infobox_fields(wikitext)["current_members"], include_unreadable=True
            )
        )
        self.assertEqual([item.names for item in items], [()])


class GenreListTest(unittest.TestCase):
    def genre(self, sentence, name="K-pop"):
        extract = f"{GROUP} is a South Korean band. {sentence}"
        found = text_evidence("genre", page(extract), [GROUP], [name])
        return (extract, locator(found))

    def test_long_list_is_still_accepted(self):
        styles = ", ".join(f"style{index}" for index in range(2000))
        extract, found = self.genre(f"{GROUP} draws on genres including {styles} and K-pop.")
        start = extract.index("K-pop")
        self.assertEqual(found, f"wikipedia:en:pageid=1:revid=1#extract[{start}:{start + 5}]")

    def test_and_inside_a_genre_name_still_counts(self):
        extract, found = self.genre(
            f"{GROUP} draws on genres including rhythm and blues, hip hop and K-pop."
        )
        start = extract.index("K-pop")
        self.assertEqual(found, f"wikipedia:en:pageid=1:revid=1#extract[{start}:{start + 5}]")

    def test_word_that_only_starts_with_and_is_a_genre_word(self):
        extract, found = self.genre(f"{GROUP} draws on genres including and-pop, K-pop.")
        start = extract.index("K-pop")
        self.assertEqual(found, f"wikipedia:en:pageid=1:revid=1#extract[{start}:{start + 5}]")

    def test_and_alone_is_not_an_item(self):
        # "and" only separates items, so a list with it as an item does not parse.
        for sentence in (
            f"{GROUP} draws on genres including and, K-pop.",
            f"{GROUP} draws on genres including pop and and rock, K-pop.",
        ):
            with self.subTest(sentence=sentence):
                self.assertIsNone(self.genre(sentence)[1])


class InfoboxOpeningTest(unittest.TestCase):
    def values(self, wikitext):
        fields = first_infobox_fields(wikitext, PERSON_TYPES)
        return {name: wikitext[start:end] for name, (start, end) in fields.items()}

    def test_fields_of_each_way_to_end_the_name(self):
        cases = {
            "{{Infobox person\n| name = A\n}}": {"name": " A\n"},
            "{{Infobox  Musical_artist  | name = A}}": {"name": " A"},
            "{{ infobox person \n\n  | name = A\n}}": {"name": " A\n"},
            "{{Infobox person\n   \n<!-- note -->\n| name = A}}": {"name": " A"},
            "{{Infobox person<ref>x</ref>| name = A}}": {"name": " A"},
            # Text on the line after the name is read as the first parameter.
            "{{Infobox person\nname = A\n| born = B\n}}": {"name": " A\n", "born": " B\n"},
            "{{Infobox person\n\n \nname = A\n}}": {"name": " A\n"},
            # No type after "Infobox", so the infobox is not an accepted one.
            "{{Infobox\t\n| name = A}}": {},
        }
        for wikitext, values in cases.items():
            with self.subTest(wikitext=wikitext):
                self.assertEqual(self.values(wikitext), values)

    def test_opening_that_does_not_end_is_skipped(self):
        wikitext = "{{Infobox person {{small|x}} | name = A}}\n{{Infobox person\n| name = B\n}}"
        self.assertEqual(self.values(wikitext), {"name": " B\n"})


class ListTemplateNameTest(unittest.TestCase):
    def test_spaces_and_breaks_around_the_name(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| label = {{ \n hlist \n | [[JYP Entertainment|JYP]] | Republic }}\n"
            "| current_members = {{Plainlist}}\n"
            "| past_members = {{  |Sohee}}\n"
            "}}"
        )
        fields = infobox_fields(wikitext)
        label = field_items(wikitext, fields["label"])
        self.assertEqual(
            [(item.names, item.start, item.end) for item in label],
            [(("JYP Entertainment", "JYP"), 50, 75), (("Republic",), 78, 86)],
        )
        self.assertEqual(field_items(wikitext, fields["current_members"], True), [])
        unnamed = field_items(wikitext, fields["past_members"], True)
        self.assertEqual([item.names for item in unnamed], [()])


class StripTemplatesTest(unittest.TestCase):
    def test_removes_templates_from_the_inside_out(self):
        cases = {
            "Keeho{{efn|a {{small|b}} c}}": "Keeho",
            "{{a}}{{b}}c": "c",
            "{{}}": "",
            # Braces that never formed a template stay.
            "{{{a}}}": "{}",
            "{{a}b}}": "{{a}b}}",
            "{ {{a}} {b}}": "{  {b}}",
            # Removing the inner template joins the braces around it.
            "{{{a}}{b}}": "",
            "x{{a{{b}}c{{d{{e}}}}f}}y": "xy",
            "}}{{": "}}{{",
        }
        for text, stripped in cases.items():
            with self.subTest(text=text):
                self.assertEqual(_strip_templates(text), stripped)

    def test_note_with_nested_templates_does_not_hide_the_name(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| current_members = Keeho{{efn|left {{small|in {{abbr|2024|year}}}} briefly}}\n"
            "}}"
        )
        items = field_items(wikitext, infobox_fields(wikitext)["current_members"])
        self.assertEqual([item.names for item in items], [("Keeho",)])


class AbbreviationTest(unittest.TestCase):
    def sentences(self, text):
        return [text[start:end] for start, end in _sentences(text)]

    def test_abbreviation_must_be_a_whole_word(self):
        self.assertEqual(self.sentences("He met Mr. Kim. They sang."), ["He met Mr. Kim.", "They sang."])
        self.assertEqual(self.sentences("He met (Dr. Kim). They sang."), ["He met (Dr. Kim).", "They sang."])
        self.assertEqual(self.sentences("It was a hamr. Kim sang."), ["It was a hamr.", "Kim sang."])
        self.assertEqual(self.sentences("St. Kim sang. Mr. Lee too."), ["St. Kim sang.", "Mr. Lee too."])

    def test_initials_of_any_length(self):
        text = "They joined S.H.I.E.L.D.A.B.C. Records in 2020. It closed."
        self.assertEqual(
            self.sentences(text),
            ["They joined S.H.I.E.L.D.A.B.C. Records in 2020.", "It closed."],
        )
        self.assertEqual(self.sentences("See planA.B. Next one."), ["See planA.B.", "Next one."])
        self.assertEqual(self.sentences("Only A. Next one."), ["Only A.", "Next one."])


class CapitalizedWordBeforeTest(unittest.TestCase):
    def clean(self, sentence, name="Name"):
        start = sentence.index(name)
        return _clean_boundaries(sentence, start, start + len(name), True)

    def test_capitalized_word_right_before_makes_the_name_partial(self):
        for sentence in (
            "Warner Name left",
            "the O'Neil-Smith  Name left",
            "the iPhone Name left",
            "Jr.\nName left",
            "x_Y Name left",
        ):
            with self.subTest(sentence=sentence):
                self.assertFalse(self.clean(sentence))

    def test_other_text_before_keeps_the_name(self):
        for sentence in (
            "Name left",
            "the singer Name left",
            "Warner, Name left",
            "Warner (Name) left",
            "Warner and Name left",
            # Only A to Z counts as a capital letter, as before.
            "École Name left",
            "A, b Name left",
        ):
            with self.subTest(sentence=sentence):
                self.assertTrue(self.clean(sentence))


if __name__ == "__main__":
    unittest.main()
