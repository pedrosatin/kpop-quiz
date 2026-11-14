import hashlib
import unittest
from collections import Counter
from datetime import date

from kpop_scraping.quiz_drafts import _build_drafts
from kpop_scraping.quiz_models import Entity, Evidence, Fact
from kpop_scraping.quiz_repository import _load_entities, _load_facts
from tests.test_quiz_generator import build_quiz_database

REFERENCE_DATE = date(2026, 9, 13)
SPARSE_INTERVAL = ("2015-01-01", "2015-12-31")


def make_entity(qid, entity_type, name, aliases=()):
    return Entity(qid, entity_type, name, {}, aliases)


def make_fact(
    statement_id, subject, predicate, value_entity=None,
    value_time=None, value_precision=None, interval=None,
):
    start, end = interval or (None, None)
    interval_precision = 11 if interval else None
    return Fact(
        statement_id, subject, predicate, value_entity,
        value_time, value_precision,
        start, interval_precision, end, interval_precision,
        (),
        (
            Evidence(
                f"fb-{statement_id}", "wikidata", f"claim-{statement_id}",
                f"https://www.wikidata.org/wiki/{subject.wikidata_id}", 7,
            ),
        ),
    )


def sparse_facts():
    """Facts too few or too conflicting to yield drafts, one per rejection path."""
    alpha = make_entity("QG1", "group", "Alpha")
    rhythm = make_entity("QG2", "group", "Rhythm Power", ("Hangzoo",))
    gamma = make_entity("QG3", "group", "Gamma")
    ana = make_entity("QP1", "person", "Ana")
    bia = make_entity("QP2", "person", "Bia")
    cris = make_entity("QP3", "person", "Cris")
    hangzoo = make_entity("QP4", "person", "Hangzoo")
    label_one = make_entity("QL1", "organization", "Label One")
    label_two = make_entity("QL2", "organization", "Label Two")
    facts = [
        make_fact("f1", alpha, "formed_on", value_time="2010-01-01", value_precision=9),
        make_fact("b1", ana, "born_on", value_time="1990-01-01", value_precision=11),
        make_fact("b2", bia, "born_on", value_time="2030-01-01", value_precision=11),
        make_fact("b3", cris, "born_on", value_time="1995-01-01", value_precision=9),
        make_fact("m1", alpha, "has_member", ana, interval=SPARSE_INTERVAL),
        make_fact("o1", ana, "member_of", alpha, interval=SPARSE_INTERVAL),
        make_fact("m2", alpha, "has_member", bia),
        make_fact("o2", bia, "member_of", alpha),
        make_fact("m3", alpha, "has_member", cris, interval=SPARSE_INTERVAL),
        make_fact("o3", cris, "member_of", alpha, interval=SPARSE_INTERVAL),
        make_fact("m4", rhythm, "has_member", hangzoo),
        make_fact("o4", hangzoo, "member_of", rhythm),
        make_fact("m5", gamma, "has_member"),
        make_fact("r1", alpha, "record_label", label_one),
        make_fact("r2", rhythm, "record_label", label_one),
        make_fact("r3", alpha, "record_label", label_two),
        make_fact("r4", gamma, "record_label"),
    ]
    entities = dict(
        enumerate(
            (alpha, rhythm, gamma, ana, bia, cris, hangzoo, label_one, label_two)
        )
    )
    return facts, entities


class BuildDraftsCharacterizationTest(unittest.TestCase):
    """Pin the drafts and rejections that ``_build_drafts`` produces today.

    The fingerprint covers every field of every draft (keys, answers,
    alternatives, values, evidence revisions and locators) and the order of
    the rejection counter. Change it only together with an intended change to
    the drafts.
    """

    def test_fixture_drafts_keep_their_fingerprint(self):
        connection = build_quiz_database()
        self.addCleanup(connection.close)
        entities = _load_entities(connection)
        facts, _load_rejections = _load_facts(connection, entities)

        drafts, rejected = _build_drafts(facts, entities, REFERENCE_DATE)

        self.assertEqual(
            dict(Counter(draft.question_type for draft in drafts)),
            {
                "age_on_date": 6,
                "birth_date_or_place": 6,
                "chronological_comparison": 7,
                "earliest_release": 5,
                "formation_year": 7,
                "group_for_member": 7,
                "group_for_record_label": 7,
                "group_for_release": 8,
                "member_at_date": 1,
                "member_for_group": 7,
                "record_label_for_group": 7,
                "release_for_group": 8,
                "release_year": 8,
            },
        )
        self.assertEqual(
            list(rejected.items()),
            [
                ("insufficient_birth_date_distractors", 1),
                ("insufficient_precision_for_age", 1),
                ("membership_interval_not_eligible", 6),
            ],
        )
        self.assertEqual(
            hashlib.sha256(repr((drafts, list(rejected.items()))).encode()).hexdigest(),
            "2a5095826c2a510d50664cbb7a265bb779f0c908f15da358ad5894f3de2b559b",
        )

    def test_sparse_facts_record_every_rejection_in_order(self):
        facts, entities = sparse_facts()

        drafts, rejected = _build_drafts(facts, entities, REFERENCE_DATE)

        self.assertEqual(drafts, [])
        self.assertEqual(
            list(rejected.items()),
            [
                ("insufficient_formation_year_distractors", 1),
                ("insufficient_birth_date_distractors", 3),
                ("insufficient_age_distractors", 1),
                ("birth_after_reference_date", 1),
                ("insufficient_precision_for_age", 1),
                ("insufficient_group_distractors", 3),
                ("insufficient_person_distractors", 2),
                ("membership_interval_not_eligible", 1),
                ("group_label_mentions_member", 2),
                ("insufficient_nonmember_distractors", 3),
                ("record_label_has_multiple_groups", 2),
                ("insufficient_record_label_group_distractors", 1),
                ("group_has_multiple_record_labels", 2),
                ("insufficient_record_label_distractors", 1),
            ],
        )


if __name__ == "__main__":
    unittest.main()
