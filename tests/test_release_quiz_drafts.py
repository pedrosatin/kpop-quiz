import unittest
from collections import Counter

from kpop_scraping.quiz_models import Entity, Evidence, Fact
from kpop_scraping.release_quiz_drafts import build_release_drafts


def make_entity(qid, entity_type, name, pt=None, en=None):
    names = {}
    if pt is not None:
        names["pt"] = pt
    if en is not None:
        names["en"] = en
    return Entity(qid, entity_type, name, names, ())


def make_evidence():
    return Evidence("fb1", "wikidata", "P175", "https://www.wikidata.org/wiki/Q1", 1)


def performer_fact(statement_id, release, group):
    return Fact(
        statement_id, release, "performed_by", group,
        None, None, None, None, None, None, (), (make_evidence(),),
    )


def date_fact(statement_id, release, value_time, precision):
    return Fact(
        statement_id, release, "released_on", None,
        value_time, precision, None, None, None, None, (), (make_evidence(),),
    )


def make_group(qid, name):
    return make_entity(qid, "group", name)


def make_release(qid, title):
    return make_entity(qid, "release", title, pt=title, en=title)


def draft_release_ids(drafts):
    found = set()
    for draft in drafts:
        found.add(draft.key[1])
        for value, _kind in draft.alternatives:
            found.add(value)
    return found


class AmbiguousTitleTest(unittest.TestCase):
    def test_savage_like_titles_excluded_everywhere(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        first = make_release("QR1", "Savage")
        second = make_release("QR2", "Savage")
        facts = []
        for index, release in enumerate((first, second)):
            facts.append(performer_fact(f"S{index}", release, groups[index]))
            facts.append(date_fact(f"D{index}", release, f"202{index}-01-01", 11))
        drafts, rejected = build_release_drafts(facts)
        self.assertNotIn("QR1", draft_release_ids(drafts))
        self.assertNotIn("QR2", draft_release_ids(drafts))
        self.assertGreater(rejected["release_title_not_unique"], 0)

    def test_case_and_punctuation_variants_count_as_same_title(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        first = make_release("QR1", "Teddy Bear")
        second = make_release("QR2", "teddy-bear")
        facts = [
            performer_fact("S1", first, groups[0]),
            performer_fact("S2", second, groups[1]),
        ]
        drafts, rejected = build_release_drafts(facts)
        self.assertNotIn("QR1", draft_release_ids(drafts))
        self.assertNotIn("QR2", draft_release_ids(drafts))
        self.assertGreater(rejected["release_title_not_unique"], 0)


class GroupNameLeakTest(unittest.TestCase):
    def test_release_mentioning_group_excluded(self):
        group = make_group("QG1", "Aespa")
        others = [make_group(f"QG{i}", f"Group {i}") for i in range(2, 6)]
        release = make_release("QR1", "Aespa Special")
        facts = [performer_fact("S1", release, group)]
        for index, other in enumerate(others):
            other_release = make_release(f"QRO{index}", f"Song {index}")
            facts.append(performer_fact(f"SO{index}", other_release, other))
        drafts, rejected = build_release_drafts(facts)
        self.assertNotIn("QR1", draft_release_ids(drafts))
        self.assertGreater(rejected["release_label_mentions_group"], 0)


class LabelUniquenessTest(unittest.TestCase):
    def test_duplicate_group_labels_never_share_options(self):
        twin_a = make_group("QG1", "Twin")
        twin_b = make_group("QG2", "Twin")
        others = [make_group(f"QG{i}", f"Group {i}") for i in range(3, 7)]
        release = make_release("QR1", "Unique Song")
        facts = [performer_fact("S1", release, twin_a)]
        for index, other in enumerate([twin_b, *others]):
            other_release = make_release(f"QRO{index}", f"Song {index}")
            facts.append(performer_fact(f"SO{index}", other_release, other))
        drafts, _rejected = build_release_drafts(facts)
        for draft in drafts:
            labels = [value for value, _kind in draft.alternatives]
            self.assertEqual(len(set(labels)), len(labels))


class YearPrecisionTest(unittest.TestCase):
    def test_year_distractors_are_nearby_years(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        facts = []
        for index, year in enumerate(("2019", "2020", "2021", "2022", "2030")):
            release = make_release(f"QR{index}", f"Song {index}")
            facts.append(performer_fact(f"S{index}", release, groups[index % 4]))
            facts.append(date_fact(f"D{index}", release, f"{year}-06-01", 11))
        drafts, _rejected = build_release_drafts(facts)
        year_drafts = [d for d in drafts if d.question_type == "release_year"]
        target = next(d for d in year_drafts if d.key[1] == "QR2")
        options = sorted(value for value, _kind in target.alternatives)
        self.assertEqual(options, ["2019", "2020", "2021", "2022"])

    def test_earliest_release_never_mixes_precisions(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        facts = []
        precisions = (9, 9, 11, 11)
        for index, precision in enumerate(precisions):
            release = make_release(f"QR{index}", f"Song {index}")
            facts.append(performer_fact(f"S{index}", release, groups[index % 4]))
            facts.append(date_fact(f"D{index}", release, f"202{index}-01-01", precision))
        drafts, _rejected = build_release_drafts(facts)
        earliest = [d for d in drafts if d.question_type == "earliest_release"]
        self.assertEqual(earliest, [])

    def test_release_year_compares_within_precision_only(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        facts = []
        for index in range(4):
            early = make_release(f"QRE{index}", f"Early Song {index}")
            facts.append(performer_fact(f"SE{index}", early, groups[index]))
            facts.append(date_fact(f"DE{index}", early, f"201{index}-01-01", 9))
            late = make_release(f"QRL{index}", f"Late Song {index}")
            facts.append(performer_fact(f"SL{index}", late, groups[index]))
            facts.append(date_fact(f"DL{index}", late, f"202{index}-05-06", 11))
        drafts, _rejected = build_release_drafts(facts)
        years = [d for d in drafts if d.question_type == "release_year"]
        self.assertEqual(len(years), 8)
        for draft in years:
            options = {value for value, _kind in draft.alternatives}
            if draft.key[1].startswith("QRE"):
                self.assertTrue(options <= {"2010", "2011", "2012", "2013"})
            else:
                self.assertTrue(options <= {"2020", "2021", "2022", "2023"})

    def test_release_with_mixed_precisions_rejected(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        release = make_release("QR1", "Mixed Song")
        facts = [
            performer_fact("S1", release, groups[0]),
            date_fact("D1", release, "2021", 9),
            date_fact("D2", release, "2021-06-01", 11),
        ]
        for index in range(1, 4):
            other = make_release(f"QRO{index}", f"Song {index}")
            facts.append(performer_fact(f"SO{index}", other, groups[index]))
            facts.append(date_fact(f"DO{index}", other, f"202{index}-01-01", 11))
        drafts, rejected = build_release_drafts(facts)
        dated = [
            d
            for d in drafts
            if d.question_type in ("release_year", "earliest_release")
            and d.key[1] == "QR1"
        ]
        self.assertEqual(dated, [])
        self.assertGreater(rejected["release_mixed_date_precisions"], 0)

    def test_release_year_needs_three_alternatives(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        facts = []
        for index, year in enumerate(("2020", "2021", "2022")):
            release = make_release(f"QR{index}", f"Song {index}")
            facts.append(performer_fact(f"S{index}", release, groups[index]))
            facts.append(date_fact(f"D{index}", release, f"{year}-01-01", 11))
        drafts, rejected = build_release_drafts(facts)
        self.assertEqual([d for d in drafts if d.question_type == "release_year"], [])
        self.assertGreater(rejected["insufficient_release_year_distractors"], 0)

    def test_earliest_release_needs_four_distinct_dates(self):
        groups = [make_group(f"QG{i}", f"Group {i}") for i in range(4)]
        facts = []
        for index in range(3):
            release = make_release(f"QR{index}", f"Song {index}")
            facts.append(performer_fact(f"S{index}", release, groups[index]))
            facts.append(date_fact(f"D{index}", release, f"202{index}-01-01", 11))
        drafts, _rejected = build_release_drafts(facts)
        self.assertEqual([d for d in drafts if d.question_type == "earliest_release"], [])


class PerformerDistractorTest(unittest.TestCase):
    def test_multi_performer_release_rejected(self):
        first = make_group("QG1", "First")
        second = make_group("QG2", "Second")
        others = [make_group(f"QG{i}", f"Group {i}") for i in range(3, 6)]
        release = make_release("QR1", "Duet Song")
        facts = [performer_fact("S1", release, first), performer_fact("S2", release, second)]
        for index, other in enumerate(others):
            other_release = make_release(f"QRO{index}", f"Song {index}")
            facts.append(performer_fact(f"SO{index}", other_release, other))
        drafts, rejected = build_release_drafts(facts)
        duet = [
            d
            for d in drafts
            if d.question_type == "group_for_release" and d.key[1] == "QR1"
        ]
        self.assertEqual(duet, [])
        self.assertGreater(rejected["release_has_multiple_performers"], 0)

    def test_insufficient_group_distractors_counted(self):
        group = make_group("QG1", "Lonely")
        release = make_release("QR1", "Solo Song")
        drafts, rejected = build_release_drafts([performer_fact("S1", release, group)])
        self.assertEqual([d for d in drafts if d.question_type == "group_for_release"], [])
        self.assertGreater(rejected["insufficient_performer_group_distractors"], 0)


if __name__ == "__main__":
    unittest.main()
