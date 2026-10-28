"""Clues taken from the answer entity's own dated fact."""

import unittest
from collections import Counter
from datetime import date

from kpop_scraping.quiz_models import Draft, Entity, Evidence, Fact
from kpop_scraping.quiz_rendering import (
    CLUE_ISOLATES_ANSWER,
    CLUE_NO_DECADE,
    CLUE_NOT_NARROWING,
    CLUE_RELATED_DISABLED,
    NO_CLUE_RULE,
    _clues_for_draft,
    index_dated_facts,
    render_play_mode_variants,
)

REFERENCE = date(2026, 9, 13)
PERSON = Entity("Q1", "person", "Ana Kim", {})
GROUPS = {
    f"G{n}": Entity(f"G{n}", "group", name, {})
    for n, name in enumerate(("Alpha", "Bravo", "Charlie", "Delta"), start=1)
}
ENTITIES = {"Q1": PERSON, **GROUPS}


def _evidence(fact_id: str) -> Evidence:
    return Evidence(fact_id, "wikidata", f"claim:{fact_id}", "https://www.wikidata.org/wiki/X", 99)


def _formed(group_id: str, value: str, precision: int = 9, fact_id: str | None = None) -> Fact:
    fact_id = fact_id or f"{group_id}$formed-{value}"
    return Fact(
        fact_id, GROUPS[group_id], "formed_on", None, value, precision,
        None, None, None, None, (), (_evidence(fact_id),),
    )


def _draft(answer: str = "G1") -> Draft:
    own = Evidence("Q1$member", "wikidata", "claim:member", "https://www.wikidata.org/wiki/Q1", 5)
    return Draft(
        ("group_for_member", "Q1$member"), "group_for_member", "members", "medium", (answer,),
        (answer, "group"), tuple((group_id, "group") for group_id in GROUPS),
        {"person_id": "Q1"}, (own,), ("Q1$member",),
    )


def _render(facts, draft=None, language="en", outcomes=None):
    return render_play_mode_variants(
        draft or _draft(), language, REFERENCE, ENTITIES, {},
        dated_facts=index_dated_facts(facts), clue_outcomes=outcomes,
    )


class RelatedDecadeClueTest(unittest.TestCase):
    def test_clue_cites_the_answer_fact_and_rules_out_known_options(self):
        facts = [_formed("G1", "2012"), _formed("G2", "2013"), _formed("G3", "1999")]
        outcomes: Counter[str] = Counter()
        assisted, standard, expert = _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({"available": 1}))
        clue = standard["clues_available"][0]
        self.assertEqual(clue["text"], "The correct group formed in the 2010s.")
        self.assertEqual(clue["fact_base_ids"], ["G1$formed-2012"])
        self.assertEqual([item["fact_base_id"] for item in clue["evidence"]], ["G1$formed-2012"])
        self.assertEqual(clue["evidence"][0]["revision_id"], 99)
        self.assertEqual(assisted["clues_shown"], [clue["id"]])
        self.assertEqual(standard["clues_shown"], [])
        self.assertEqual(expert["clues_available"], [])
        self.assertNotIn("G1$formed-2012", standard["fact_base_ids"])

    def test_portuguese_text(self):
        facts = [_formed("G1", "2012"), _formed("G2", "2013"), _formed("G3", "1999")]
        clue = _render(facts, language="pt-BR")[1]["clues_available"][0]
        self.assertEqual(clue["text"], "O grupo correto foi formado na década de 2010.")

    def test_clue_never_names_an_option(self):
        facts = [_formed("G1", "2012"), _formed("G2", "2013"), _formed("G3", "1999")]
        text = _render(facts)[1]["clues_available"][0]["text"].casefold()
        self.assertTrue(all(group.canonical_name.casefold() not in text for group in GROUPS.values()))

    def test_rejects_a_clue_that_leaves_only_the_answer(self):
        facts = [_formed("G1", "2012"), _formed("G2", "1999"), _formed("G3", "2001"), _formed("G4", "1988")]
        outcomes: Counter[str] = Counter()
        variants = _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_ISOLATES_ANSWER: 1}))
        self.assertTrue(all(item["clues_available"] == [] for item in variants))
        self.assertTrue(all(item["clues_shown"] == [] for item in variants))

    def test_options_without_a_dated_fact_stay_possible(self):
        # G2 to G4 have no fact: nothing is ruled out, so there is no clue.
        outcomes: Counter[str] = Counter()
        _render([_formed("G1", "2012")], outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NOT_NARROWING: 1}))

    def test_rejects_a_clue_that_rules_out_nothing(self):
        facts = [_formed(group_id, "2011") for group_id in GROUPS]
        outcomes: Counter[str] = Counter()
        _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NOT_NARROWING: 1}))

    def test_no_clue_without_a_dated_fact_for_the_answer(self):
        facts = [_formed("G2", "2013"), _formed("G3", "1999")]
        outcomes: Counter[str] = Counter()
        _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NO_DECADE: 1}))

    def test_no_clue_when_the_answer_has_dates_in_two_decades(self):
        facts = [_formed("G1", "2012"), _formed("G1", "2003", fact_id="G1$other"),
                 _formed("G2", "2013"), _formed("G3", "1999")]
        outcomes: Counter[str] = Counter()
        _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NO_DECADE: 1}))

    def test_option_with_two_decades_is_not_ruled_out(self):
        facts = [_formed("G1", "2012"), _formed("G2", "2013"),
                 _formed("G3", "1999"), _formed("G3", "2011", fact_id="G3$other")]
        # G3 names the answer's decade among its dates, so it stays possible.
        outcomes: Counter[str] = Counter()
        _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NOT_NARROWING: 1}))

    def test_decade_precision_dates_are_not_used(self):
        facts = [_formed("G1", "2010", precision=8), _formed("G2", "1999"), _formed("G3", "2001")]
        outcomes: Counter[str] = Counter()
        _render(facts, outcomes=outcomes)
        self.assertEqual(outcomes, Counter({CLUE_NO_DECADE: 1}))

    def test_facts_without_evidence_are_not_indexed(self):
        unsourced = Fact("G1$x", GROUPS["G1"], "formed_on", None, "2012", 9,
                         None, None, None, None, (), ())
        self.assertEqual(index_dated_facts([unsourced]), {})

    def test_question_types_with_dates_in_the_prompt_have_no_related_rule(self):
        draft = Draft(
            ("record_label_for_group", "x"), "record_label_for_group", "labels", "easy", ("G1",),
            ("L1", "organization"), (("L1", "organization"),), {}, (), ("x",),
        )
        self.assertEqual(_clues_for_draft(draft, "en", {}, {}, ENTITIES), ([], NO_CLUE_RULE))


class RelatedCluesAreOffByDefaultTest(unittest.TestCase):
    """A client released before related clues rejects any session that carries one."""

    FACTS = [_formed("G1", "2012"), _formed("G2", "2013"), _formed("G3", "1999")]

    def test_without_dated_facts_the_question_has_no_clue_and_says_why(self):
        outcomes: Counter[str] = Counter()
        variants = render_play_mode_variants(
            _draft(), "en", REFERENCE, ENTITIES, {}, clue_outcomes=outcomes,
        )
        self.assertEqual(outcomes, Counter({CLUE_RELATED_DISABLED: 1}))
        self.assertTrue(all(item["clues_available"] == [] and item["clues_shown"] == [] for item in variants))

    def test_enabling_them_is_the_only_difference(self):
        off = render_play_mode_variants(_draft(), "en", REFERENCE, ENTITIES, {})
        on = _render(self.FACTS)
        for disabled, enabled in zip(off, on):
            keys = set(disabled) | set(enabled)
            self.assertEqual(
                {key for key in keys if disabled.get(key) != enabled.get(key)} - {"clues_available", "clues_shown"},
                set(),
            )

    def test_enabled_clue_leaves_the_questions_own_facts_so_an_older_client_would_reject_it(self):
        standard = _render(self.FACTS)[1]
        cited = {fact_id for clue in standard["clues_available"] for fact_id in clue["fact_base_ids"]}
        self.assertTrue(cited and not cited <= set(standard["fact_base_ids"]))

    def test_own_fact_clues_stay_inside_the_questions_facts(self):
        draft = Draft(
            ("formation_year", "G1$formed-2012"), "formation_year", "debut", "easy", ("2012",),
            ("2012", "time"), (("2012", "time"), ("2013", "time"), ("1999", "time"), ("2003", "time")),
            {"group_id": "G1", "date": "2012"}, (_evidence("G1$formed-2012"),), ("G1$formed-2012",),
        )
        standard = render_play_mode_variants(draft, "en", REFERENCE, ENTITIES, {})[1]
        for clue in standard["clues_available"]:
            self.assertLessEqual(set(clue["fact_base_ids"]), set(standard["fact_base_ids"]))


if __name__ == "__main__":
    unittest.main()
