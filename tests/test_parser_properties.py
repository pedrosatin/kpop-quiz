"""Property tests for wikitext and infobox parsers.

Covers birth-date and formation parsers, short-name extraction, and release
evidence. Three properties hold for every generated input:

(a) the call raises no unhandled exception;
(b) it finishes inside the Hypothesis deadline (catches catastrophic
    backtracking of the class fixed in the security audit);
(c) each normalization applied twice equals the result of one pass.

Hypothesis comes only from ``requirements-ci.txt``. Without it these tests
skip so ``python -m unittest discover -v`` still runs on a bare interpreter.
"""

from __future__ import annotations

import unittest

SKIP_REASON = "hypothesis is not installed (install via requirements-ci.txt)"

try:
    from hypothesis import example, given, strategies as st

    import tests.hypothesis_profile  # noqa: F401 - loads parser-ci settings
except ImportError:
    hypothesis_available = False
else:
    hypothesis_available = True

from kpop_scraping.entities import GREGORIAN_CALENDAR, PRECISION_DAY, PRECISION_YEAR, TimeValue
from kpop_scraping.evidence import (
    WikipediaPage,
    _credit_name_pattern,
    formation_category_check,
    formation_date_evidence,
    page_title_name,
    release_date_evidence,
    release_performer_evidence,
    text_evidence,
)
from kpop_scraping.infobox import (
    _item_names,
    _strip_templates,
    field_items,
    first_infobox_fields,
    infobox_fields,
)
from kpop_scraping.person_evidence import (
    _mask,
    _stated_date,
    _without_trailing_notes,
    person_infobox_check,
)

PERSON_TYPES = frozenset({"person", "musical artist"})


class PageTitleNameRegressionTest(unittest.TestCase):
    """Fixed examples found by the property suite; run without Hypothesis."""

    def test_only_the_final_disambiguator_is_dropped(self):
        # The function is not idempotent on purpose: a parenthesis before the
        # disambiguator can belong to the name. Stripping until stable would
        # turn this source page, kept in data/kpop.db, into "Tell Me Your Wish".
        self.assertEqual(
            page_title_name("Tell Me Your Wish (Genie) (canção)"),
            "Tell Me Your Wish (Genie)",
        )
        self.assertEqual(page_title_name("Exo (group)"), "Exo")


def person_page(wikitext: str) -> WikipediaPage:
    return WikipediaPage(7, "en", 10, 20, "", "Someone", wikitext, "Q1", False)


def group_page(extract: str, wikitext: str = "") -> WikipediaPage:
    return WikipediaPage(1, "en", 1, 1, extract, "Group", wikitext)


def day(value: str = "2015-10-20") -> TimeValue:
    return TimeValue(value, PRECISION_DAY, GREGORIAN_CALENDAR)


def year(value: str = "2015") -> TimeValue:
    return TimeValue(value, PRECISION_YEAR, GREGORIAN_CALENDAR)


if not hypothesis_available:

    class ParserPropertyTests(unittest.TestCase):
        """Placeholder so discover reports an explicit skip without Hypothesis."""

        def test_infobox_fields_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_field_items_on_every_span_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_item_names_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_strip_templates_is_idempotent(self):
            self.skipTest(SKIP_REASON)

        def test_item_names_is_idempotent_on_plain_result(self):
            self.skipTest(SKIP_REASON)

        def test_person_infobox_check_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_stated_date_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_mask_is_idempotent(self):
            self.skipTest(SKIP_REASON)

        def test_without_trailing_notes_is_idempotent(self):
            self.skipTest(SKIP_REASON)

        def test_formation_date_evidence_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_credit_name_pattern_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_page_title_name_keeps_a_prefix(self):
            self.skipTest(SKIP_REASON)

        def test_item_names_on_infobox_values_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_release_evidence_never_raise(self):
            self.skipTest(SKIP_REASON)

        def test_template_whitespace_through_field_items(self):
            self.skipTest(SKIP_REASON)

        def test_infobox_opening_whitespace(self):
            self.skipTest(SKIP_REASON)

else:

    def wiki_chars():
        return st.sampled_from("abcABC012 \n\t|{}[]<>=/#*_-'\".,;:()")

    def bounded_text(max_size: int = 240):
        return st.text(alphabet=wiki_chars(), min_size=0, max_size=max_size)

    def whitespace_run(max_size: int = 120):
        """Runs of spaces or newlines; the shape that made TEMPLATE_NAME cubic."""
        return st.binary(min_size=0, max_size=max_size).map(
            lambda raw: "".join("\n" if byte % 2 else " " for byte in raw)
        )

    def template_opening():
        """``{{`` + whitespace + name fragment, including the audit ReDoS shape."""
        return st.builds(
            lambda lead, name, trail, rest: "{{" + lead + name + trail + rest,
            whitespace_run(80),
            st.sampled_from(["", "hlist", "Infobox", "Infobox person", "efn", "x"]),
            whitespace_run(80),
            st.sampled_from(["", "|", "}}", "|a}}", "\nx", "| name = A\n}}"]),
        )

    def wikitext_samples():
        plain = bounded_text(200)
        wrapped = st.builds(
            lambda opening, body: opening + body,
            template_opening(),
            bounded_text(120),
        )
        infobox = st.builds(
            lambda kind, field, value, pad: (
                "{{Infobox " + kind + "\n| " + field + " = " + pad + value + "\n}}\n"
            ),
            st.sampled_from(["musical artist", "person", "x"]),
            st.sampled_from(
                ["name", "birth_date", "birth_place", "current_members", "label"]
            ),
            st.one_of(
                bounded_text(80),
                st.builds(lambda n: "{{birth date|1993|1|12}}" + n, bounded_text(40)),
                st.builds(lambda n: "[[Seoul]]" + n, bounded_text(40)),
                st.builds(
                    lambda ws: "{{" + ws + "hlist|[[A]]|[[B]]}}", whitespace_run(60)
                ),
            ),
            whitespace_run(40),
        )
        return st.one_of(plain, wrapped, infobox)

    def extract_samples():
        return st.one_of(
            bounded_text(200),
            st.builds(
                lambda group, date, mid: (
                    f"{group} is a South Korean band. {group} formed{mid}in {date}."
                ),
                st.sampled_from(["Twice", "Exo", "BTS", "Group"]),
                st.sampled_from(["2015", "2015-10-20", "October 20, 2015"]),
                st.sampled_from([" ", " in Seoul ", " as a trio "]),
            ),
            st.builds(
                lambda title, artist, date: (
                    f"{title} is a single by {artist}. It was released on {date}."
                ),
                st.sampled_from(["Alpha", "Song", "DNA"]),
                st.sampled_from(["BTS", "Twice", "IU"]),
                st.sampled_from(["2017-09-18", "September 18, 2017", "2017"]),
            ),
        )

    def short_name_samples():
        return st.one_of(
            st.sampled_from(["BTS", "IU", "V", "Can", "UN", "f(x)", "Exo", "Twice"]),
            st.text(
                alphabet=st.sampled_from(
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -"
                ),
                min_size=0,
                max_size=24,
            ),
        )

    class InfoboxPropertyTest(unittest.TestCase):
        """Infobox field and short-name parsers stay total, fast and idempotent."""

        @given(wikitext_samples())
        def test_infobox_fields_never_raise(self, wikitext: str) -> None:
            infobox_fields(wikitext)
            first_infobox_fields(wikitext, PERSON_TYPES)

        @given(wikitext_samples())
        def test_field_items_on_every_span_never_raise(self, wikitext: str) -> None:
            fields = infobox_fields(wikitext) or first_infobox_fields(
                wikitext, PERSON_TYPES
            )
            for span in fields.values():
                field_items(wikitext, span)
                field_items(wikitext, span, include_unreadable=True)

        @given(bounded_text(160))
        def test_item_names_never_raise(self, raw: str) -> None:
            _item_names(raw)

        @given(bounded_text(200))
        def test_strip_templates_is_idempotent(self, text: str) -> None:
            once = _strip_templates(text)
            self.assertEqual(_strip_templates(once), once)

        @given(bounded_text(160))
        def test_item_names_is_idempotent_on_plain_result(self, raw: str) -> None:
            names = _item_names(raw)
            for name in names:
                self.assertEqual(_item_names(name), (name,) if name else ())

    class BirthDatePropertyTest(unittest.TestCase):
        """Birth-date and birth-place infobox checks stay total, fast and idempotent."""

        @given(wikitext_samples())
        def test_person_infobox_check_never_raise(self, wikitext: str) -> None:
            page = person_page(wikitext)
            person_infobox_check(
                "born_on",
                page,
                "Q1",
                TimeValue("1993-01-12", PRECISION_DAY, GREGORIAN_CALENDAR),
            )
            person_infobox_check("born_in", page, "Q1", value_names=["Seoul", "Busan"])

        @given(bounded_text(200))
        def test_stated_date_never_raise(self, body: str) -> None:
            _stated_date(body, 0, len(body))

        @given(bounded_text(200))
        def test_mask_is_idempotent(self, text: str) -> None:
            once = _mask(text)
            self.assertEqual(_mask(once), once)

        @given(bounded_text(200))
        def test_without_trailing_notes_is_idempotent(self, text: str) -> None:
            start, end = _without_trailing_notes(text, 0, len(text))
            again = _without_trailing_notes(text, start, end)
            self.assertEqual(again, (start, end))

    class FormationPropertyTest(unittest.TestCase):
        """Formation date and category parsers stay total and fast."""

        @given(extract_samples(), wikitext_samples())
        def test_formation_date_evidence_never_raise(
            self, extract: str, wikitext: str
        ) -> None:
            page = group_page(extract, wikitext)
            formation_date_evidence(page, day(), ("Group", "Twice"))
            formation_date_evidence(page, year(), ("Group",))
            formation_category_check(page, year())
            text_evidence("formed_on", page, ["Group"], [], time=day())

    class ShortNamePropertyTest(unittest.TestCase):
        """Short credit names and page-title normalization stay total."""

        @given(short_name_samples())
        def test_credit_name_pattern_never_raise(self, name: str) -> None:
            _credit_name_pattern(name)

        @given(bounded_text(80))
        def test_page_title_name_keeps_a_prefix(self, title: str) -> None:
            self.assertTrue(title.strip().startswith(page_title_name(title)))

        @given(wikitext_samples())
        def test_item_names_on_infobox_values_never_raise(self, wikitext: str) -> None:
            for span in infobox_fields(wikitext).values():
                for item in field_items(wikitext, span, include_unreadable=True):
                    _item_names(item.text)

    class ReleaseEvidencePropertyTest(unittest.TestCase):
        """Release date and performer evidence stay total and fast."""

        @given(extract_samples())
        def test_release_evidence_never_raise(self, extract: str) -> None:
            page = group_page(extract)
            release_date_evidence(page, day("2017-09-18"), ("Alpha", "Song"))
            release_performer_evidence(page, ("BTS", "Twice", "IU"), ("Alpha", "Song"))
            text_evidence("released_on", page, ["Alpha"], [], time=day("2017-09-18"))
            text_evidence("performed_by", page, ["Alpha"], ["BTS"])

    class AdversarialWhitespacePropertyTest(unittest.TestCase):
        """Whitespace runs that triggered the audit ReDoS stay under the deadline."""

        @example("\n" * 600)
        @given(whitespace_run(600))
        def test_template_whitespace_through_field_items(self, pad: str) -> None:
            # Audit shape: whitespace then prose and a nested template, with no
            # "|" after the opening braces. Size 600 stays under 2 ms with the
            # possessive TEMPLATE_NAME and about 1.4 s with the lazy pre-fix
            # pattern, above the 500 ms Hypothesis deadline.
            wikitext = (
                "{{Infobox musical artist\n| name = Testgroup\n| current_members = {{"
                + pad
                + "Dummy Person{{efn|note}}}}\n}}\n"
            )
            fields = infobox_fields(wikitext)
            if "current_members" in fields:
                field_items(wikitext, fields["current_members"])

        @example(" " * 800)
        @given(whitespace_run(800))
        def test_infobox_opening_whitespace(self, pad: str) -> None:
            # Old ANY_INFOBOX_START was cubic on spaces after "Infobox"; the
            # possessive pattern keeps this under the deadline.
            first_infobox_fields(
                "{{Infobox" + pad + "person\n| name = A\n}}", PERSON_TYPES
            )
            first_infobox_fields("{{Infobox" + pad + "x", PERSON_TYPES)
