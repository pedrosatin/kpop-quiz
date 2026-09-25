"""Regression tests for per-word clues and labels in the word search generator."""

from __future__ import annotations

import sqlite3
import unittest
from datetime import date

from kpop_scraping.quiz_models import Entity, Evidence, Fact
from kpop_scraping.word_search_generator import (
    WordCandidate,
    _build_candidate,
    _drop_uninformative_clues,
    extract_viable_themes,
    generate_word_search_puzzle,
)
from kpop_scraping.quiz_repository import _load_entities, _load_facts
from kpop_scraping.word_search_schema import (
    validate_word_search_clues,
    validate_word_search_puzzle,
)
from tests.test_word_search_generator import build_word_search_test_database

TWICE = "Q21480414"
RED_VELVET = "Q17425336"

# (member QID, statement id, birth value, precision)
TWICE_BIRTHS = [
    ("Q21040333", "born-nayeon", "+1995-09-22T00:00:00Z", 11),
    ("Q21040344", "born-jeongyeon", "+1996-11-01T00:00:00Z", 11),
    ("Q21040355", "born-momo", "+1996-11-09T00:00:00Z", 11),
    ("Q21040366", "born-sana", "+1996-12-29T00:00:00Z", 11),
    ("Q21040377", "born-jihyo", "+1997-02-01T00:00:00Z", 11),
    ("Q21040388", "born-mina", "+1997-03-24T00:00:00Z", 11),
    ("Q21040399", "born-dahyun", "+1998-05-28T00:00:00Z", 11),
    ("Q21040400", "born-chaeyoung", "+1999-04-23T00:00:00Z", 11),
    # Decade precision: too coarse to state a birth year.
    ("Q21040411", "born-tzuyu", "+1990-00-00T00:00:00Z", 8),
]


def _entity_row(conn: sqlite3.Connection, qid: str) -> int:
    return int(conn.execute("SELECT id FROM entities WHERE wikidata_id=?", (qid,)).fetchone()[0])


def _insert_fact(
    conn: sqlite3.Connection,
    statement_id: str,
    subject_qid: str,
    predicate: str,
    *,
    value_qid: str | None = None,
    value_time: str | None = None,
    value_precision: int | None = None,
) -> None:
    value_entity = _entity_row(conn, value_qid) if value_qid else None
    cur = conn.execute(
        """
        INSERT INTO facts(
            statement_id, subject_entity_id, predicate, property_id, rank,
            value_wikidata_id, value_entity_id, value_time, value_precision,
            status, quality_flags_json
        ) VALUES (?, ?, ?, 'P0', 'normal', ?, ?, ?, ?, 'accepted', '[]')
        """,
        (
            statement_id,
            _entity_row(conn, subject_qid),
            predicate,
            value_qid,
            value_entity,
            value_time,
            value_precision,
        ),
    )
    conn.execute(
        """
        INSERT INTO fact_evidence(
            fact_id, evidence_type, source_key, locator, reference_hash,
            wikidata_snapshot_id
        ) VALUES (?, 'wikidata_reference', 'wikidata', ?, 'ref1', 1)
        """,
        (cur.lastrowid, f"claims/{statement_id}"),
    )


def build_clue_database() -> sqlite3.Connection:
    conn = build_word_search_test_database()
    for member_qid, statement_id, value, precision in TWICE_BIRTHS:
        _insert_fact(
            conn, statement_id, member_qid, "born_on",
            value_time=value, value_precision=precision,
        )
    # Tzuyu is also recorded in another group: the rarest clue for her.
    _insert_fact(conn, "tzuyu-member-of-nct", "Q21040411", "member_of", value_qid="Q23765422")
    conn.commit()
    return conn


def _themes(conn: sqlite3.Connection) -> dict[str, object]:
    conn.row_factory = sqlite3.Row
    entities = _load_entities(conn)
    facts, _ = _load_facts(conn, entities)
    return {theme.theme_id: theme for theme in extract_viable_themes(entities, facts, 12, 12)}


def _fact_ids(entry: dict) -> set[str]:
    return {item["fact_base_id"] for item in entry["evidence"]}


class TestMemberThemeClues(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = build_clue_database()

    def tearDown(self) -> None:
        self.conn.close()

    def test_member_clues_state_audited_facts_not_the_theme(self) -> None:
        puzzle = generate_word_search_puzzle(
            self.conn, seed="clues-twice", reference_date=date(2026, 9, 18),
            theme_filter=f"members_{TWICE.lower()}",
        )
        clues = [word["clue"] for word in puzzle["words"] if "clue" in word]
        self.assertEqual(len(clues), len(puzzle["words"]))
        self.assertGreater(len({clue["en"] for clue in clues}), 1)
        for word in puzzle["words"]:
            self.assertNotEqual(word["clue"]["pt-BR"], puzzle["theme"]["pt-BR"])
            self.assertNotEqual(word["clue"]["en"], puzzle["theme"]["en"])
            self.assertNotIn("TWICE", word["clue"]["en"])
        validate_word_search_clues(puzzle)

    def test_birth_year_clue_carries_birth_evidence(self) -> None:
        theme = _themes(self.conn)[f"members_{TWICE.lower()}"]
        by_word = {cand.word: cand for cand in theme.candidates}
        nayeon = by_word["NAYEON"]
        self.assertEqual(nayeon.clue, {"pt-BR": "Nasceu em 1995", "en": "Born in 1995"})
        published = {item["fact_base_id"] for item in nayeon.published_evidence()}
        self.assertEqual(published, {"twice-member-Q21040333", "born-nayeon"})

    def test_rarest_option_wins_and_coarse_birth_is_ignored(self) -> None:
        theme = _themes(self.conn)[f"members_{TWICE.lower()}"]
        by_word = {cand.word: cand for cand in theme.candidates}
        # 1996 is shared by three members; each still gets the only fact it has.
        self.assertEqual(by_word["MOMO"].clue["en"], "Born in 1996")
        # Tzuyu's birth has decade precision, so the other group is used.
        self.assertEqual(
            by_word["TZUYU"].clue,
            {"pt-BR": "Também integrante de NCT", "en": "Also a member of NCT"},
        )
        self.assertIn(
            "tzuyu-member-of-nct",
            {item["fact_base_id"] for item in by_word["TZUYU"].published_evidence()},
        )

    def test_members_without_distinguishing_facts_get_no_clue(self) -> None:
        puzzle = generate_word_search_puzzle(
            self.conn, seed="clues-rv", reference_date=date(2026, 9, 18),
            theme_filter=f"members_{RED_VELVET.lower()}",
        )
        for word in puzzle["words"]:
            self.assertNotIn("clue", word)
            self.assertTrue(all(ev["fact_base_id"].startswith("rv-member-") for ev in word["evidence"]))
        validate_word_search_clues(puzzle)


    def test_rarer_option_beats_kind_priority(self) -> None:
        # Momo's birth year (1996) is shared by three members; NCT membership
        # is shared by two, so it wins over the higher-priority birth year.
        _insert_fact(self.conn, "momo-member-of-nct", "Q21040355", "member_of", value_qid="Q23765422")
        self.conn.commit()
        by_word = {cand.word: cand for cand in _themes(self.conn)[f"members_{TWICE.lower()}"].candidates}
        self.assertEqual(by_word["MOMO"].clue["en"], "Also a member of NCT")
        self.assertIn("momo-member-of-nct", {item["fact_base_id"] for item in by_word["MOMO"].published_evidence()})
        self.assertNotIn("born-momo", {item["fact_base_id"] for item in by_word["MOMO"].published_evidence()})

    def test_equally_rare_options_follow_kind_priority(self) -> None:
        # Nayeon's birth year and her Red Velvet membership are both unique.
        _insert_fact(self.conn, "nayeon-member-of-rv", "Q21040333", "member_of", value_qid=RED_VELVET)
        self.conn.commit()
        by_word = {cand.word: cand for cand in _themes(self.conn)[f"members_{TWICE.lower()}"].candidates}
        self.assertEqual(by_word["NAYEON"].clue["en"], "Born in 1995")

    def test_conflicting_birth_years_give_no_birth_clue(self) -> None:
        _insert_fact(
            self.conn, "born-chaeyoung-alt", "Q21040400", "born_on",
            value_time="+2000-04-23T00:00:00Z", value_precision=11,
        )
        self.conn.commit()
        by_word = {cand.word: cand for cand in _themes(self.conn)[f"members_{TWICE.lower()}"].candidates}
        self.assertIsNone(by_word["CHAEYOUNG"].clue)
        self.assertEqual(by_word["CHAEYOUNG"].clue_evidence, ())

class TestGroupThemeClues(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = build_word_search_test_database()

    def tearDown(self) -> None:
        self.conn.close()

    def test_label_theme_uses_formation_year(self) -> None:
        puzzle = generate_word_search_puzzle(
            self.conn, seed="clues-jyp", reference_date=date(2026, 9, 18),
            theme_filter="label_jyp",
        )
        for word in puzzle["words"]:
            self.assertRegex(word["clue"]["en"], r"^Group formed in \d{4}$")
            self.assertIn(f"formed-{word['id']}", _fact_ids(word))
            self.assertNotIn("JYP", word["clue"]["en"])
        validate_word_search_clues(puzzle)

    def test_decade_theme_clue_is_more_specific_than_decade(self) -> None:
        theme = _themes(self.conn)["formed_2010s"]
        clues = {cand.word: cand.clue["en"] for cand in theme.candidates}
        self.assertEqual(clues["ITZY"], "Group formed in 2019")
        # EXO shares the year 2012 with no one in the 2010s pool.
        self.assertEqual(clues["EXO"], "Group formed in 2012")


class TestClueValidation(unittest.TestCase):
    def _puzzle(self) -> dict:
        conn = build_clue_database()
        try:
            return generate_word_search_puzzle(
                conn, seed="validate", reference_date=date(2026, 9, 18),
                theme_filter=f"members_{TWICE.lower()}",
            )
        finally:
            conn.close()

    def test_rejects_identical_clues(self) -> None:
        puzzle = self._puzzle()
        for word in puzzle["words"]:
            word["clue"] = {"pt-BR": "Integrante", "en": "Member"}
        validate_word_search_puzzle(puzzle)
        with self.assertRaisesRegex(ValueError, "all word clues are identical"):
            validate_word_search_clues(puzzle)

    def test_rejects_clue_equal_to_theme(self) -> None:
        puzzle = self._puzzle()
        puzzle["words"][0]["clue"] = dict(puzzle["theme"])
        with self.assertRaisesRegex(ValueError, "repeats the theme title"):
            validate_word_search_clues(puzzle)

    def test_rejects_published_super_junior_t_pattern(self) -> None:
        puzzle = self._puzzle()
        puzzle["theme"] = {"pt-BR": "Integrantes do grupo Super Junior-T", "en": "Members of Super Junior-T"}
        for word in puzzle["words"]:
            word["clue"] = {"pt-BR": "Integrante do grupo Super Junior-T", "en": "Member of Super Junior-T"}
        with self.assertRaises(ValueError):
            validate_word_search_clues(puzzle)

    def test_accepts_puzzle_without_clues(self) -> None:
        puzzle = self._puzzle()
        for word in puzzle["words"]:
            word.pop("clue", None)
        validate_word_search_clues(puzzle)

    def test_generator_drops_clues_when_all_identical(self) -> None:
        base = WordCandidate("Q1", "AAA", "Aaa", {"pt-BR": "Aaa", "en": "Aaa"}, None, [])
        same = {"pt-BR": "Nasceu em 1990", "en": "Born in 1990"}
        evidence = [{
            "fact_base_id": "born", "locator": "l", "revision_id": 1,
            "source_key": "wikidata", "source_url": "https://example.org",
        }]
        cands = [
            base._replace(id="Q1", word="AAA", clue=same, clue_evidence=evidence),
            base._replace(id="Q2", word="BBB", clue=same, clue_evidence=evidence),
            base._replace(id="Q3", word="CCC"),
        ]
        result = _drop_uninformative_clues(cands)
        self.assertTrue(all(cand.clue is None for cand in result))
        self.assertTrue(all(cand.published_evidence() == [] for cand in result))
        mixed = [cands[0], cands[1]._replace(clue={"pt-BR": "Nasceu em 1991", "en": "Born in 1991"})]
        self.assertEqual(_drop_uninformative_clues(mixed), mixed)


def _membership_fact(entity: Entity) -> Fact:
    evidence = Evidence("Q1$1", "wikipedia:en", "extract[0:1]", "https://en.wikipedia.org/", 1)
    return Fact(
        "s1", entity, "has_member", None, None, None, None, None, None, None, (), (evidence,)
    )


class TestWordLabels(unittest.TestCase):
    def test_person_label_is_the_same_name_in_both_locales(self) -> None:
        # Wikidata labels: pt "Kim Heechul", en "Kim Hee-chul" (Q380123).
        heechul = Entity(
            "Q380123", "person", "Kim Hee-chul",
            {"pt": "Kim Heechul", "en": "Kim Hee-chul"}, ("Heechul",),
        )
        cand = _build_candidate(heechul, [_membership_fact(heechul)], min_dim=12)
        assert cand is not None
        self.assertEqual(cand.word, "KIMHEECHUL")
        self.assertEqual(cand.labels, {"pt-BR": "Kim Hee-chul", "en": "Kim Hee-chul"})

    def test_label_follows_the_name_that_produced_the_word(self) -> None:
        # The canonical name is too long for a 10x10 grid; the alias is used
        # for the word and for both labels.
        entity = Entity(
            "Q7", "person", "Kim Hee-chul Long Name", {"en": "Kim Hee-chul Long Name"}, ("Heechul",),
        )
        cand = _build_candidate(entity, [_membership_fact(entity)], min_dim=10)
        assert cand is not None
        self.assertEqual(cand.word, "HEECHUL")
        self.assertEqual(cand.labels, {"pt-BR": "Heechul", "en": "Heechul"})


if __name__ == "__main__":
    unittest.main()
