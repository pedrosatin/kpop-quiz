import unittest

from kpop_scraping.facts import (
    FactCandidate,
    PredicateSpec,
    country_value_ids,
    group_fact_candidates,
    member_ids,
    person_fact_candidates,
    _single_time,
)
from kpop_scraping.entities import QualifierTime, TimeValue, PRECISION_YEAR
from wikidata_fixture import SUNMI, SUNYE, TWICE, WONDER_GIRLS, load_fixture


class FactsTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()

    def test_group_fact_candidates(self):
        entity = self.fixture["subject_profile"][TWICE]
        facts = group_fact_candidates(TWICE, entity)

        self.assertEqual(facts.ignored, 0)
        self.assertEqual(len(facts.issues), 0)

        predicates = {c.predicate for c in facts.candidates}
        self.assertIn("genre", predicates)
        self.assertIn("record_label", predicates)
        self.assertIn("origin_country", predicates)
        self.assertIn("has_member", predicates)
        self.assertIn("formed_in", predicates)
        self.assertNotIn("formed_on", predicates)  # TWICE fixture doesn't have P571 in the script output

        # Check has_member extracted correctly
        members = member_ids(facts.candidates)
        self.assertTrue(len(members) > 0)

    def test_group_fact_candidates_formed_on(self):
        entity = self.fixture["subject_profile"][WONDER_GIRLS]
        facts = group_fact_candidates(WONDER_GIRLS, entity)

        predicates = {c.predicate for c in facts.candidates}
        self.assertIn("formed_on", predicates)
        self.assertIn("has_member", predicates)

    def test_person_fact_candidates_filtering(self):
        entity = self.fixture["subject_profile"][SUNYE]

        # Without known groups, if P463 is member_of, it requires known_groups check
        facts_unknown = person_fact_candidates(SUNYE, entity, known_groups=[])
        predicates_unknown = {c.predicate for c in facts_unknown.candidates}
        self.assertNotIn("member_of", predicates_unknown)
        self.assertIn("born_on", predicates_unknown)

        # With known group
        facts_known = person_fact_candidates(SUNYE, entity, known_groups=[WONDER_GIRLS])
        predicates_known = {c.predicate for c in facts_known.candidates}
        self.assertIn("member_of", predicates_known)

        # Check that the member_of candidate points to WONDER_GIRLS
        member_of_candidate = next(c for c in facts_known.candidates if c.predicate == "member_of")
        self.assertEqual(member_of_candidate.value_id, WONDER_GIRLS)

    def test_country_value_ids(self):
        entity = self.fixture["subject_profile"][TWICE]
        facts = group_fact_candidates(TWICE, entity)

        countries = country_value_ids(facts.candidates)
        # TWICE is from South Korea Q884 (origin_country)
        self.assertIn("Q884", countries)

    def test_member_ids(self):
        entity = self.fixture["subject_profile"][WONDER_GIRLS]
        facts = group_fact_candidates(WONDER_GIRLS, entity)

        members = member_ids(facts.candidates)
        # SUNYE and SUNMI should be in members (and others)
        self.assertIn(SUNYE, members)
        self.assertIn(SUNMI, members)

        # Check sorting
        self.assertEqual(members, sorted(members))

    def test_single_time_error_and_unknown(self):
        flags = set()

        # 1. empty
        time_val, err = _single_time((), "start", flags)
        self.assertIsNone(time_val)
        self.assertIsNone(err)

        # 2. ambiguous (multiple values)
        q1 = QualifierTime(TimeValue("2010", PRECISION_YEAR, "http://www.wikidata.org/entity/Q1985727"), "value")
        q2 = QualifierTime(TimeValue("2011", PRECISION_YEAR, "http://www.wikidata.org/entity/Q1985727"), "value")
        time_val, err = _single_time((q1, q2), "start", flags)
        self.assertIsNone(time_val)
        self.assertEqual(err, "ambiguous_temporal_qualifiers")

        # 3. somevalue
        qs = QualifierTime(None, "somevalue")
        time_val, err = _single_time((qs,), "end", flags)
        self.assertIsNone(time_val)
        self.assertIsNone(err)
        self.assertIn("end_date_unknown", flags)

        # 4. novalue
        qn = QualifierTime(None, "novalue")
        flags.clear()
        time_val, err = _single_time((qn,), "start", flags)
        self.assertIsNone(time_val)
        self.assertIsNone(err)
        self.assertEqual(len(flags), 0)

        # 5. error
        qe = QualifierTime(None, "value", "invalid_time_value")
        time_val, err = _single_time((qe,), "start", flags)
        self.assertIsNone(time_val)
        self.assertEqual(err, "invalid_start_qualifier")

        # 6. valid
        qv = QualifierTime(TimeValue("2010", PRECISION_YEAR, "http://www.wikidata.org/entity/Q1985727"), "value")
        time_val, err = _single_time((qv,), "start", flags)
        self.assertEqual(time_val.value, "2010")
        self.assertIsNone(err)

    def test_precision_below_day_flag(self):
        entity = self.fixture["subject_profile"][SUNYE]
        # P463 member of wonder girls
        facts = person_fact_candidates(SUNYE, entity, known_groups=[WONDER_GIRLS])

        member_of = next(c for c in facts.candidates if c.predicate == "member_of")
        self.assertIn("validity_precision_below_day", member_of.flags)

        # For born_on we can check flags if we find one
        born_on_list = [c for c in facts.candidates if c.predicate == "born_on"]
        if born_on_list:
            born_on = born_on_list[0]
            if born_on.time and born_on.time.precision < 11:
                self.assertIn("precision_below_day", born_on.flags)
                self.assertIn("insufficient_precision_for_age", born_on.flags)


if __name__ == "__main__":
    unittest.main()
