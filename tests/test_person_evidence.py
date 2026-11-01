import json
import unittest
from pathlib import Path

from kpop_scraping.entities import GREGORIAN_CALENDAR, TimeValue
from kpop_scraping.evidence import WikipediaPage
from kpop_scraping.person_evidence import (
    COARSE_PLACE,
    VALUE_AMBIGUOUS,
    VALUE_DIFFERS,
    person_infobox_check,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "person_infobox_cases.json").read_text(encoding="utf-8")
)
PAGES = {(page["qid"], page["requested_title"]): page for page in FIXTURE["pages"]}
OUTCOMES = {"accepted": None, "differs": VALUE_DIFFERS, "ambiguous": VALUE_AMBIGUOUS, "none": None}
PERSON = "Q1"


def time(value, precision=11, calendar=GREGORIAN_CALENDAR):
    return TimeValue(value, precision, calendar)


def person_page(wikitext, wikidata_id=PERSON, is_redirect=False):
    return WikipediaPage(7, "en", 10, 20, "", "Someone", wikitext, wikidata_id, is_redirect)


def infobox(**fields):
    body = "\n".join(f"| {name} = {value}" for name, value in fields.items())
    return "{{Short description|Singer}}\n{{Infobox person\n| name = Someone\n" + body + "\n}}\n'''Someone'''"


def born_on(wikitext, value="1993-01-12", precision=11, **page_options):
    return person_infobox_check(
        "born_on", person_page(wikitext, **page_options), PERSON, time(value, precision)
    )


def born_in(wikitext, names=("Seoul",), **page_options):
    return person_infobox_check(
        "born_in", person_page(wikitext, **page_options), PERSON, None, names
    )


class RecordedCasesTest(unittest.TestCase):
    """Cases cut from real revisions; each locator points into the original wikitext."""

    def test_every_case_has_the_recorded_outcome_and_a_citable_locator(self):
        self.assertGreaterEqual(len(FIXTURE["cases"]), 20)
        for case in FIXTURE["cases"]:
            with self.subTest(case["id"]):
                page = next(
                    item for item in FIXTURE["pages"]
                    if item["qid"] == case["qid"] and item["requested_title"] == item["title"]
                )
                wikidata = case["wikidata"]
                wiki_page = WikipediaPage(
                    1, "en", page["pageid"], page["revid"], "", page["title"],
                    page["wikitext_prefix"], page["wikidata_id"], page["is_redirect"],
                )
                if case["predicate"] == "born_on":
                    check = person_infobox_check(
                        "born_on", wiki_page, case["qid"],
                        time(wikidata["time"], wikidata["precision"]),
                    )
                else:
                    check = person_infobox_check(
                        "born_in", wiki_page, case["qid"], None, wikidata["names"]
                    )
                expected = case["expect"]
                outcome = expected["outcome"]
                if outcome == "accepted":
                    self.assertIsNotNone(check.evidence)
                    self.assertIsNone(check.rejection_reason)
                    shown = check.evidence
                    self.assertEqual(list(shown.flags), expected.get("flags", []))
                else:
                    self.assertIsNone(check.evidence)
                    self.assertEqual(check.rejection_reason, OUTCOMES[outcome])
                    shown = check.observed
                if outcome == "none":
                    self.assertIsNone(shown)
                    continue
                self.assertEqual(shown.snippet, expected["snippet"])
                locator = f"wikipedia:en:pageid={page['pageid']}:revid={page['revid']}#{expected['locator']}"
                self.assertEqual(shown.locator, locator)
                start, end = (
                    int(part) for part in expected["locator"][len("wikitext["):-1].split(":")
                )
                field, _, value = expected["snippet"].partition(" = ")
                self.assertEqual(page["wikitext_prefix"][start:end], value)
                self.assertNotIn("<ref", value)
                self.assertNotIn("<!--", value)
                self.assertTrue(page["permalink"].endswith(f"oldid={page['revid']}"))

    def test_fixture_covers_positive_negative_and_ambiguous_cases(self):
        outcomes = {
            (case["predicate"], case["expect"]["outcome"]) for case in FIXTURE["cases"]
        }
        for predicate in ("born_on", "born_in"):
            for outcome in ("accepted", "differs", "none"):
                self.assertIn((predicate, outcome), outcomes)
        self.assertIn(("born_in", "ambiguous"), outcomes)
        self.assertTrue(any(case["origin"] == "real" for case in FIXTURE["cases"]))

    def test_pages_of_redirected_titles_never_serve_as_evidence(self):
        redirects = [page for page in FIXTURE["pages"] if page["requested_title"] != page["title"]]
        self.assertEqual({page["requested_title"] for page in redirects}, {"EunB", "Kyujin (singer)"})
        for page in redirects:
            with self.subTest(page["requested_title"]):
                self.assertTrue(page["is_redirect"])
                self.assertNotEqual(page["wikidata_id"], page["qid"])
                self.assertIn("origin", page["wikitext_prefix"])
                names = ("Seoul", "South Korea")
                for flag in (True, False):
                    wiki_page = WikipediaPage(
                        1, "en", page["pageid"], page["revid"], "", page["title"],
                        page["wikitext_prefix"], page["wikidata_id"], flag,
                    )
                    check = person_infobox_check("born_in", wiki_page, page["qid"], None, names)
                    self.assertEqual(check, check.__class__())


class IdentityTest(unittest.TestCase):
    def test_redirect_wrong_item_and_missing_item_are_refused(self):
        wikitext = infobox(birth_place="[[Seoul]], South Korea")
        self.assertIsNotNone(born_in(wikitext).evidence)
        for options in (
            {"is_redirect": True},
            {"wikidata_id": "Q2"},
            {"wikidata_id": ""},
        ):
            with self.subTest(options):
                check = born_in(wikitext, **options)
                self.assertEqual((check.evidence, check.rejection_reason, check.observed), (None, None, None))

    def test_page_without_wikitext_or_subject_has_no_verdict(self):
        self.assertIsNone(born_in("").evidence)
        check = person_infobox_check(
            "born_in", person_page(infobox(birth_place="[[Seoul]]")), "", None, ("Seoul",)
        )
        self.assertIsNone(check.evidence)

    def test_only_the_first_infobox_of_an_accepted_type_counts(self):
        place = "birth_place = [[Seoul]]"
        accepted = (
            "{{Infobox musical artist\n| name = A\n| " + place + "\n}}",
            "{{infobox_person\n| " + place + "\n}}",
            "{{Infobox Person|" + place + "}}",
        )
        for wikitext in accepted:
            with self.subTest(wikitext):
                self.assertIsNotNone(born_in(wikitext).evidence)
        refused = (
            "{{Infobox YouTube personality\n| " + place + "\n}}\n{{Infobox person\n| " + place + "\n}}",
            "{{Infobox person/doc\n| " + place + "\n}}",
            "{{Infobox\n| " + place + "\n}}",
            "<!-- {{Infobox person\n| " + place + "\n}} -->",
            "<nowiki>{{Infobox person\n| " + place + "\n}}</nowiki>",
            "{{Infobox person\n| name = A\n",
        )
        for wikitext in refused:
            with self.subTest(wikitext):
                self.assertEqual(born_in(wikitext).evidence, None)

    def test_a_commented_out_infobox_does_not_hide_the_real_one(self):
        wikitext = (
            "<!-- {{Infobox person\n| birth_place = [[Busan]]\n}} -->\n"
            + infobox(birth_place="[[Seoul]]")
        )
        check = born_in(wikitext)
        self.assertIn("[[Seoul]]", check.evidence.snippet)

    def test_summary_body_categories_and_other_fields_prove_nothing(self):
        body = (
            infobox(origin="[[Seoul]]", residence="[[Seoul]]")
            + " Born in [[Seoul]], born January 12, 1993.\n[[Category:Singers from Seoul]]"
        )
        self.assertEqual(born_in(body).evidence, None)
        self.assertEqual(born_in(body).rejection_reason, None)
        self.assertEqual(born_on(body).evidence, None)
        page = WikipediaPage(
            7, "en", 10, 20, "Someone (born January 12, 1993) is a singer from Seoul.",
            "Someone", body, PERSON,
        )
        self.assertIsNone(person_infobox_check("born_on", page, PERSON, time("1993-01-12")).evidence)

    def test_other_person_predicates_are_left_alone(self):
        wikitext = infobox(birth_date="{{birth date|1993|1|12}}", birth_place="[[Seoul]]", nationality="[[Seoul]]")
        for predicate in ("citizenship", "speaks_language", "plays_instrument", "member_of"):
            check = person_infobox_check(predicate, person_page(wikitext), PERSON, time("1993-01-12"), ("Seoul",))
            self.assertEqual((check.evidence, check.rejection_reason), (None, None))


class BirthDateTest(unittest.TestCase):
    def test_templates_with_year_month_and_day_prove_the_same_date(self):
        forms = (
            "{{Birth date and age|1993|1|12}}",
            "{{birth date and age|1993|01|12}}",
            "{{Birth date|1993|1|12}}",
            "{{bda|1993|1|12}}",
            "{{dob|1993|1|12}}",
            "{{birth_date_and_age|1993|1|12}}",
            "{{birth date and age |1993|1|12}}",
            "{{birth date and age|df=y|1993|1|12}}",
            "{{birth date and age|1993|1|12|mf=yes}}",
            "{{birth date and age|1993|1|12}} (age 33)",
            "{{birth date and age|1993|1|12}}<ref>{{cite web|url=https://example.test|title=A|B}}</ref>",
            "{{birth date and age|1993|1|12}} <!-- updates itself -->",
        )
        for form in forms:
            with self.subTest(form):
                check = born_on(infobox(birth_date=form))
                self.assertIsNotNone(check.evidence)
                self.assertEqual(check.evidence.snippet[:13], "birth_date = ")

    def test_written_dates_prove_the_same_date(self):
        forms = (
            "January 12, 1993", "12 January 1993", "1993-01-12", "[[January 12]], [[1993]]",
            "[[12 January]] [[1993]]", "January 12 1993", "<br />January 12, 1993",
            "January 12, 1993 (age 33)",
        )
        for form in forms:
            with self.subTest(form):
                self.assertIsNotNone(born_on(infobox(birth_date=form)).evidence)

    def test_locator_holds_the_template_without_trailing_reference_or_comment(self):
        wikitext = infobox(birth_date="{{birth date and age|1993|1|12}}<ref>x</ref> <!-- y -->")
        check = born_on(wikitext)
        start, end = (int(n) for n in check.evidence.locator.rsplit("[", 1)[1][:-1].split(":"))
        self.assertEqual(wikitext[start:end], "{{birth date and age|1993|1|12}}")

    def test_a_different_date_is_a_divergence_with_the_page_text(self):
        for form in (
            "{{birth date and age|1993|1|13}}", "{{birth date and age|1993|2|12}}",
            "{{birth date and age|1994|1|12}}", "January 13, 1993", "1993-01-13",
        ):
            with self.subTest(form):
                check = born_on(infobox(birth_date=form))
                self.assertEqual((check.evidence, check.rejection_reason), (None, VALUE_DIFFERS))
                self.assertIn("birth_date = ", check.observed.snippet)

    def test_year_precision_compares_only_the_year(self):
        wikitext = infobox(birth_date="{{birth date and age|1993|1|12}}")
        self.assertIsNotNone(born_on(wikitext, "1993", 9).evidence)
        check = born_on(wikitext, "1994", 9)
        self.assertEqual(check.rejection_reason, VALUE_DIFFERS)

    def test_precision_outside_the_gate_and_other_calendars_have_no_verdict(self):
        wikitext = infobox(birth_date="{{birth date and age|1993|1|12}}")
        for value, precision in (("1993-01", 10), ("199", 8), ("1993-01-12", 12)):
            with self.subTest(precision):
                check = born_on(wikitext, value, precision)
                self.assertEqual((check.evidence, check.rejection_reason, check.observed), (None, None, None))
        julian = person_infobox_check(
            "born_on", person_page(wikitext), PERSON,
            TimeValue("1993-01-12", 11, "http://www.wikidata.org/entity/Q1985786"),
        )
        self.assertIsNone(julian.evidence)
        self.assertIsNone(julian.rejection_reason)
        self.assertIsNone(person_infobox_check("born_on", person_page(wikitext), PERSON, None).evidence)

    def test_unreadable_date_fields_are_ambiguous_and_never_accepted(self):
        forms = (
            "{{birth date and age|1993|1}}",
            "{{birth date and age|1993}}",
            "{{birth date and age|1993|1|12|5}}",
            "{{birth date and age|1993|February|12}}",
            "{{birth date and age|1993|2|30}}",
            "{{birth date and age|1993|13|1}}",
            "{{birth date and age|year=1993|month=1|day=12}}",
            "{{birth date and age2|2026|1|1|1993|1|12}}",
            "{{birth-date|January 12, 1993}}",
            "{{circa|1993}}",
            "{{birth date and age|1993|1|12}} and {{birth date and age|1994|1|12}}",
            "{{birth date and age|1993|1|12}}{{small|(official)}}",
            "January 12, 1993 or January 13, 1993",
            "c. January 12, 1993",
            "January 1993",
            "1993",
            "unknown",
            "{{nowrap|January 12, 1993}}",
        )
        for form in forms:
            with self.subTest(form):
                check = born_on(infobox(birth_date=form))
                self.assertIsNone(check.evidence)
                self.assertEqual(check.rejection_reason, VALUE_AMBIGUOUS)
                self.assertIsNotNone(check.observed)

    def test_empty_missing_or_blank_fields_say_nothing(self):
        for wikitext in (
            infobox(birth_date=""),
            infobox(birth_date="<!-- unknown -->"),
            infobox(birth_date="<ref>x</ref>"),
            infobox(name2="x"),
        ):
            with self.subTest(wikitext):
                check = born_on(wikitext)
                self.assertEqual((check.evidence, check.rejection_reason, check.observed), (None, None, None))


class BirthPlaceTest(unittest.TestCase):
    def test_a_whole_item_equal_to_a_name_or_alias_proves_the_place(self):
        cases = (
            ("[[Seoul]], South Korea", "[[Seoul]]"),
            ("[[Seoul|The capital]]", "[[Seoul|The capital]]"),
            ("[[Seoul Special City|Seoul]]", "[[Seoul Special City|Seoul]]"),
            ("[[Gyeongseong]]", "[[Gyeongseong]]"),
            ("seoul, South Korea", "seoul"),
            ("Seoul<br />South Korea", "Seoul"),
            ("{{flatlist|\n* [[Seoul]]\n* South Korea\n}}", "[[Seoul]]"),
            ("[[Seoul]] (formerly Hanseong)", "[[Seoul]] (formerly Hanseong)"),
            ("[[Seoul]]<ref name=a>x</ref>", "[[Seoul]]"),
            ("[[Seoul]]<ref>x</ref><!-- y -->", "[[Seoul]]"),
        )
        names = ("Seoul", "Seoul Special City", "Gyeongseong")
        for field, shown in cases:
            with self.subTest(field):
                wikitext = infobox(birth_place=field)
                check = born_in(wikitext, names)
                self.assertIsNotNone(check.evidence)
                self.assertEqual(check.evidence.snippet, f"birth_place = {shown}")
                start, end = (int(n) for n in check.evidence.locator.rsplit("[", 1)[1][:-1].split(":"))
                self.assertEqual(wikitext[start:end], shown)

    def test_a_more_specific_item_before_the_match_flags_a_coarse_place(self):
        names = ("Seoul",)
        self.assertEqual(born_in(infobox(birth_place="[[Seoul]], South Korea"), names).evidence.flags, ())
        coarse = born_in(infobox(birth_place="[[Mapo District]], [[Seoul]], South Korea"), names)
        self.assertEqual(coarse.evidence.flags, (COARSE_PLACE,))

    def test_other_places_are_a_divergence_with_the_page_text(self):
        cases = ("[[Busan]], South Korea", "South Korea", "[[Seoul National University]]", "[[Taoyuan, Taiwan|Taoyuan]], Taiwan")
        for field in cases:
            with self.subTest(field):
                check = born_in(infobox(birth_place=field))
                self.assertEqual((check.evidence, check.rejection_reason), (None, VALUE_DIFFERS))
                self.assertEqual(check.observed.snippet, f"birth_place = {field}")

    def test_a_name_inside_a_longer_item_proves_nothing(self):
        for field in ("Seoul National University Hospital", "[[Seoul]]-based", "North Seoul"):
            with self.subTest(field):
                check = born_in(infobox(birth_place=field))
                self.assertIsNone(check.evidence)
                self.assertIn(check.rejection_reason, (VALUE_DIFFERS, VALUE_AMBIGUOUS))

    def test_a_value_the_item_only_qualifies_is_ambiguous(self):
        check = born_in(
            infobox(birth_place="[[Nam District, Busan]], South Korea"), ("Nam District", "Nam-gu")
        )
        self.assertEqual((check.evidence, check.rejection_reason), (None, VALUE_AMBIGUOUS))

    def test_unreadable_items_without_a_match_are_ambiguous(self):
        for field in (
            "[[Seoul]] and [[Busan]]",
            "{{nowrap|[[Busan]], Korea}}",
            "[[Busan]] [[Daegu]]",
            "[[Busan]] (formerly [[Hanseong]])",
            "(unknown)",
        ):
            with self.subTest(field):
                check = born_in(infobox(birth_place=field))
                self.assertEqual((check.evidence, check.rejection_reason), (None, VALUE_AMBIGUOUS))

    def test_a_match_wins_over_unreadable_items_beside_it(self):
        check = born_in(infobox(birth_place="[[Seoul]]<br />(raised in [[Busan]])"))
        self.assertIsNotNone(check.evidence)

    def test_empty_missing_field_or_names_say_nothing(self):
        for wikitext in (infobox(birth_place=""), infobox(birth_place="<ref>x</ref>"), infobox(other="x")):
            with self.subTest(wikitext):
                check = born_in(wikitext)
                self.assertEqual((check.evidence, check.rejection_reason, check.observed), (None, None, None))
        no_names = born_in(infobox(birth_place="[[Seoul]]"), ())
        self.assertEqual((no_names.evidence, no_names.rejection_reason), (None, None))
        one_letter = born_in(infobox(birth_place="[[S]]"), ("S",))
        self.assertEqual((one_letter.evidence, one_letter.rejection_reason), (None, None))


if __name__ == "__main__":
    unittest.main()
