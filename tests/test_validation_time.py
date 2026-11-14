"""Time limit for validating many statements of one item with many names.

Repeated statements and long alias lists are what any Wikidata editor can add
to an item. The timed input below is 1000 P577 statements with the same date
on a release with 1000 short aliases and three pages of ten sentences. The old
code took 8.7 s of CPU time on a laptop with Python 3.14 and 17.3 s with
Python 3.12, with 3000 calls of ``text_evidence``: each statement read the
three pages again, each page sorted the 1000 names again, and each sentence
escaped and joined them again. The current code takes about 0.02 s with three calls, so the
one-second limit leaves a wide margin for a slow machine.
The other tests pin the decisions the reused search must keep.
"""

import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

from kpop_scraping import validation
from kpop_scraping.evidence import (
    SUBJECT_PATTERN_CACHE_SIZE,
    WikipediaPage,
    _leading_subject,
    _leading_subject_pattern,
    _named_subject_pattern,
    _sorted_subject_names,
    subject_names_for,
)
from kpop_scraping.facts import group_fact_candidates
from kpop_scraping.release_facts import release_fact_candidates
from kpop_scraping.validation import ValidationContext, validate_facts

LIMIT_SECONDS = 1.0
ROOT = Path(__file__).resolve().parent.parent
RELEASE = "Q100"
GROUP = "Q1"
CALENDAR = "http://www.wikidata.org/entity/Q1985727"
LEAD = "Alpha is the first EP by the group Group One."
FILLER = "It was recorded in Seoul over several weeks in a small studio."
DATE_SENTENCE = "It was released by Label One on January 2, 2020."


def reference(domain):
    url = {"snaktype": "value", "datavalue": {"type": "string", "value": f"https://www.{domain}/a"}}
    return [{"hash": domain, "snaks": {"P854": [url]}}]


def date_statement(statement_id, day=2, domain=None):
    value = {"time": f"+2020-01-{day:02d}T00:00:00Z", "precision": 11, "calendarmodel": CALENDAR}
    return {
        "id": statement_id, "rank": "normal", "type": "statement",
        "mainsnak": {"property": "P577", "snaktype": "value", "datatype": "time",
                     "datavalue": {"type": "time", "value": value}},
        "qualifiers": {}, "references": reference(domain) if domain else [],
    }


def label_statement(statement_id, start_year):
    start = {"time": f"+{start_year}-00-00T00:00:00Z", "precision": 9, "calendarmodel": CALENDAR}
    return {
        "id": statement_id, "rank": "normal", "type": "statement",
        "mainsnak": {"property": "P264", "snaktype": "value", "datatype": "wikibase-item",
                     "datavalue": {"type": "wikibase-entityid", "value": {"id": "Q30"}}},
        "qualifiers": {"P580": [{"snaktype": "value", "datavalue": {"type": "time", "value": start}}]},
        "references": [],
    }


def release_page(number, extract):
    return WikipediaPage(number, "en", number, number, extract, "Alpha")


def release_context(names, pages):
    return ValidationContext(
        names={RELEASE: tuple(names)}, entity_types={}, group_pages={},
        release_pages={RELEASE: tuple(pages)},
    )


def counted(call):
    """Run ``call`` and return its result with the calls of ``text_evidence``."""
    real = validation.text_evidence
    calls = []

    def spy(*args, **kwargs):
        calls.append(args[:2])
        return real(*args, **kwargs)

    with mock.patch.object(validation, "text_evidence", spy):
        return call(), len(calls)


def summary(decisions):
    return [
        (d.candidate.statement.statement_id, d.status, d.reason, [e.locator for e in d.evidence])
        for d in decisions
    ]


class TimeLimitTest(unittest.TestCase):
    def timed(self, call):
        """Run ``call`` and fail when it uses more CPU time than the limit."""
        start = time.process_time()
        result = call()
        self.assertLess(time.process_time() - start, LIMIT_SECONDS)
        return result

    def adversarial(self, days):
        statements = [date_statement(f"{RELEASE}$d{index:04d}", days[index % len(days)]) for index in range(1000)]
        candidates = release_fact_candidates(RELEASE, {"claims": {"P577": statements}}).candidates
        extract = " ".join([LEAD] + [FILLER] * 9)
        pages = [release_page(number, extract) for number in (1, 2, 3)]
        context = release_context((f"N{index:03d}" for index in range(1000)), pages)
        return self.timed(lambda: counted(lambda: validate_facts(candidates, context)))

    def test_repeated_date_with_many_aliases(self):
        decisions, calls = self.adversarial((2,))
        self.assertLessEqual(calls, 1 * 3)
        self.assertEqual(
            sorted({(d.status, d.reason) for d in decisions}),
            [("rejected", "missing_evidence"), ("superseded", "duplicate_value")],
        )
        self.assertEqual(sum(d.status == "rejected" for d in decisions), 1)

    def test_three_repeated_dates_with_many_aliases(self):
        decisions, calls = self.adversarial((2, 3, 4))
        self.assertLessEqual(calls, 3 * 3)
        self.assertEqual(sum(d.status == "conflict" for d in decisions), 3)
        self.assertEqual(sum(d.status == "superseded" for d in decisions), 997)


class ReusedSearchTest(unittest.TestCase):
    def test_duplicates_share_the_page_where_the_date_is(self):
        extract = f"{LEAD} {DATE_SENTENCE}"
        pages = [release_page(1, LEAD), release_page(2, extract)]
        statements = [date_statement(f"{RELEASE}$d{index}") for index in range(3)]
        candidates = release_fact_candidates(RELEASE, {"claims": {"P577": statements}}).candidates
        decisions, calls = counted(lambda: validate_facts(candidates, release_context(["Alpha"], pages)))
        begin = extract.index("January 2, 2020")
        locator = f"wikipedia:en:pageid=2:revid=2#extract[{begin}:{begin + 15}]"
        self.assertEqual(calls, 2)
        self.assertEqual(
            summary(decisions),
            [
                (f"{RELEASE}$d0", "accepted", None, [locator]),
                (f"{RELEASE}$d1", "superseded", "duplicate_value", [locator]),
                (f"{RELEASE}$d2", "superseded", "duplicate_value", [locator]),
            ],
        )

    def test_rejection_reason_comes_from_each_statement(self):
        # The page answer is shared, the reference verdict is not.
        pages = [release_page(1, LEAD)]
        for first, second, reason in (
            ("imdb.com", None, "unreliable_reference_source"),
            (None, "imdb.com", "missing_evidence"),
        ):
            statements = [
                date_statement(f"{RELEASE}$a", domain=first),
                date_statement(f"{RELEASE}$b", domain=second),
            ]
            candidates = release_fact_candidates(RELEASE, {"claims": {"P577": statements}}).candidates
            with self.subTest(reason=reason):
                decisions = validate_facts(candidates, release_context(["Alpha"], pages))
                self.assertEqual(
                    summary(decisions),
                    [
                        (f"{RELEASE}$a", "rejected", reason, []),
                        (f"{RELEASE}$b", "superseded", "duplicate_value", []),
                    ],
                )

    def test_reference_of_one_duplicate_does_not_reach_the_others(self):
        statements = [
            date_statement(f"{RELEASE}$a"),
            date_statement(f"{RELEASE}$b", domain="jype.com"),
        ]
        candidates = release_fact_candidates(RELEASE, {"claims": {"P577": statements}}).candidates
        decisions, calls = counted(
            lambda: validate_facts(candidates, release_context(["Alpha"], [release_page(1, LEAD)]))
        )
        self.assertEqual(calls, 1)
        self.assertEqual(
            summary(decisions),
            [
                (f"{RELEASE}$a", "superseded", "duplicate_value", []),
                (f"{RELEASE}$b", "accepted", None, [f"claims/P577/{RELEASE}$b/references/jype.com"]),
            ],
        )

    def test_one_value_in_two_periods_reads_the_page_once(self):
        extract = "Twice is a girl group. Twice signed with JYP Entertainment in 2015."
        page = WikipediaPage(1, "en", 1, 1, extract, "Twice")
        statements = [label_statement(f"{GROUP}$l2015", 2015), label_statement(f"{GROUP}$l2019", 2019)]
        candidates = group_fact_candidates(GROUP, {"claims": {"P264": statements}}).candidates
        context = ValidationContext(
            names={GROUP: ("Twice",), "Q30": ("JYP Entertainment",)},
            entity_types={"Q30": "organization"},
            group_pages={GROUP: page},
        )
        decisions, calls = counted(lambda: validate_facts(candidates, context))
        begin = extract.index("JYP Entertainment")
        locator = f"wikipedia:en:pageid=1:revid=1#extract[{begin}:{begin + 17}]"
        self.assertEqual(calls, 1)
        self.assertEqual(
            summary(decisions),
            [(f"{GROUP}$l2015", "accepted", None, [locator]), (f"{GROUP}$l2019", "accepted", None, [locator])],
        )


class SubjectPatternTest(unittest.TestCase):
    def test_alternation_keeps_the_order_it_is_given(self):
        # The first name that fits wins, which moves where the predicate starts.
        sentence = "A B is a group."
        self.assertEqual(_leading_subject(sentence, ("A", "A B")).end(), 1)
        self.assertEqual(_leading_subject(sentence, ["A B", "A"]).end(), 3)

    def test_subject_names_sort_the_same_whatever_their_input_order(self):
        page = WikipediaPage(1, "en", 1, 1, "", "A+B (group)")
        names = [" Tw*ce", "A", "twice", "TWICE", "Tw*ce", "(G)I-dle", ""]
        expected = ("(G)I-dle", "TWICE", "Tw*ce", "twice", "A+B", "A")
        self.assertEqual(subject_names_for(page, names), expected)
        self.assertEqual(subject_names_for(page, reversed(names)), expected)

    def test_caches_keep_a_bounded_number_of_name_lists(self):
        page = WikipediaPage(1, "en", 1, 1, "", "Alpha")
        for index in range(SUBJECT_PATTERN_CACHE_SIZE * 4):
            names = subject_names_for(page, [f"Name{index}"])
            _leading_subject("Alpha is a group.", names)
            _named_subject_pattern(names)
        for cached in (_sorted_subject_names, _leading_subject_pattern, _named_subject_pattern):
            with self.subTest(cache=cached.__name__):
                self.assertEqual(cached.cache_info().maxsize, SUBJECT_PATTERN_CACHE_SIZE)
                self.assertLessEqual(cached.cache_info().currsize, SUBJECT_PATTERN_CACHE_SIZE)

    def test_a_second_sentence_reuses_the_pattern_of_the_first(self):
        names = subject_names_for(WikipediaPage(1, "en", 1, 1, "", "Alpha"), ["Reuse Probe Name"])
        _leading_subject("Reuse Probe Name is a group.", names)
        hits = _leading_subject_pattern.cache_info().hits
        _leading_subject("Reuse Probe Name is a band.", names)
        self.assertGreater(_leading_subject_pattern.cache_info().hits, hits)

    def test_decisions_do_not_depend_on_the_hash_seed(self):
        # Names overlap as prefixes, change case and carry regex characters.
        script = (
            "from tests.test_validation_time import *\n"
            "names = ['Alpha', 'Alpha Beta', 'ALPHA', 'Al', 'Alpha+', 'Alph?a', 'alpha beta']\n"
            "extract = 'Alpha Beta is the first EP by the group Group One. ' + DATE_SENTENCE\n"
            "pages = [release_page(1, LEAD), release_page(2, extract)]\n"
            "statements = [date_statement(f'Q100$d{i}') for i in range(4)]\n"
            "candidates = release_fact_candidates(RELEASE, {'claims': {'P577': statements}}).candidates\n"
            "print(summary(validate_facts(candidates, release_context(set(names), pages))))\n"
        )
        outputs = set()
        for seed in ("0", "1", "4242"):
            result = subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                cwd=ROOT,
                env={**os.environ, "PYTHONHASHSEED": seed},
                check=True,
                text=True,
                timeout=60,
            )
            outputs.add(result.stdout)
        self.assertEqual(len(outputs), 1)
        self.assertIn("accepted", outputs.pop())


if __name__ == "__main__":
    unittest.main()
