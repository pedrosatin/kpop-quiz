"""Regression coverage for revision-bounded current grid member counts."""

from __future__ import annotations

import json
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping.evidence import INFOBOX_LABEL_FIELDS, WikipediaPage, infobox_evidence
from kpop_scraping.grid_generator import evaluate_group_criteria
from kpop_scraping.grid_membership import grid_member_facts
from kpop_scraping.quiz_models import Entity, Evidence, Fact
from kpop_scraping.quiz_repository import _load_entities, _load_facts
from tests.test_grid_generator import build_grid_test_database

FIXTURE = Path(__file__).parent / 'fixtures' / 'grid-idle-roster.json'


class GridMembershipTest(unittest.TestCase):
    def setUp(self) -> None:
        self.db = build_grid_test_database()
        self.addCleanup(self.db.close)
        self.source = json.loads(FIXTURE.read_text())
        self.db.execute("INSERT INTO entities VALUES (10000, 'Q51885404', 'group', 'I-dle')")
        self.db.execute("INSERT INTO source_pages VALUES (249, 'wikipedia', 'en', 57057212)")
        self.db.execute('INSERT INTO source_revisions VALUES (249, 249, 1374817865)')
        for index, member in enumerate(self.source['members'], 10001):
            self.db.execute('INSERT INTO entities VALUES (?, ?, ?, ?)',
                            (index, member['qid'], 'person', member['name']))
            for name in member['aliases']:
                self.db.execute("INSERT INTO entity_aliases VALUES (?, 'en', ?, 'alias')", (index, name))
            cursor = self.db.execute("""
                INSERT INTO facts(statement_id, subject_entity_id, predicate, value_entity_id,
                                  status, quality_flags_json, valid_from, valid_from_precision,
                                  valid_to, valid_to_precision)
                VALUES (?, 10000, 'has_member', ?, 'accepted', ?, ?, ?, ?, ?)
            """, (member['statement_id'], index, json.dumps(member['flags']),
                  member['valid_from'], member['valid_from_precision'], member['valid_to'], member['valid_to_precision']))
            self.db.execute("""
                INSERT INTO fact_evidence(fact_id, evidence_type, source_revision_id, source_key, locator, snippet)
                VALUES (?, 'wikipedia_revision', 249, 'wikipedia:en', ?, ?)
            """, (cursor.lastrowid, member['locator'], member['snippet']))

    def selected(self, reference_date: date = date(2026, 10, 25)):
        entities = _load_entities(self.db)
        facts, _ = _load_facts(self.db, entities)
        return grid_member_facts(self.db, facts, entities, reference_date)

    def test_idle_current_five_excludes_soojin_but_keeps_historical_fact(self) -> None:
        entities = _load_entities(self.db)
        facts, _ = _load_facts(self.db, entities)
        group = entities[10000]
        before, _, _ = evaluate_group_criteria(facts, {group.wikidata_id: group})
        self.assertIn('members_6', before[group.wikidata_id])
        selected = self.selected()
        self.assertEqual(len(selected), 5)
        self.assertNotIn('Q61100297', {f.value_entity.wikidata_id for f in selected})
        self.assertEqual(self.db.execute("SELECT status FROM facts WHERE value_entity_id=10006").fetchone()[0], 'accepted')
        self.assertTrue(all(f.evidence[0].revision_id == 1374817865 for f in selected))
        self.assertFalse(any('296:302' in e.locator for f in selected for e in f.evidence))
        criteria, _, _ = evaluate_group_criteria(selected, {'Q51885404': selected[0].subject}, {'Q51885404'})
        self.assertIn('members_5', criteria['Q51885404'])
        self.assertNotIn('members_6', criteria['Q51885404'])

    def test_rejected_conflicting_or_unloaded_current_member_blocks_the_count(self) -> None:
        for status in ('rejected', 'conflict', 'stale', 'superseded'):
            with self.subTest(status=status):
                self.db.execute("UPDATE facts SET status=? WHERE value_entity_id=10001", (status,))
                self.assertEqual(self.selected(), [])
        self.db.execute("UPDATE facts SET status='accepted' WHERE value_entity_id=10001")
        self.db.execute('DELETE FROM fact_evidence WHERE fact_id=(SELECT id FROM facts WHERE value_entity_id=10001)')
        self.assertEqual(self.selected(), [])

    def test_missing_end_is_not_current_roster_proof(self) -> None:
        self.db.execute("UPDATE facts SET valid_from=NULL, valid_to=NULL, quality_flags_json='[]'")
        self.db.execute("UPDATE fact_evidence SET snippet='I-dle was originally a sextet ensemble.' WHERE source_revision_id=249")
        self.assertEqual(self.selected(), [])

    def test_historical_list_is_not_current_proof(self) -> None:
        self.db.execute("UPDATE fact_evidence SET snippet=replace(snippet, 'consists of', 'consisted of')")
        self.assertEqual(self.selected(), [])

    def test_two_closed_rosters_that_disagree_block_count(self) -> None:
        self.db.execute("UPDATE fact_evidence SET snippet='The group consists of six members: Miyeon, Minnie, Soyeon, Yuqi, Shuhua, and Soojin.' WHERE snippet LIKE '%departed%'")
        self.assertEqual(self.selected(), [])

    def test_partial_duplicate_ambiguous_and_truncated_lists_fail_closed(self) -> None:
        for snippet in (
            'The group consists of six members: Miyeon, Minnie, Soyeon, Yuqi, and Shuhua.',
            'The group consists of five members: Miyeon, Minnie, Soyeon, Yuqi, and Unknown.',
            'The group consists of five members: Miyeon, Minnie, Soyeon, Yuqi, and Yuqi.',
            'The group consists of five members: Miyeon, Minnie, Soyeon, Yuqi...',
        ):
            with self.subTest(snippet=snippet):
                self.db.execute("UPDATE fact_evidence SET snippet=? WHERE source_revision_id=249", (snippet,))
                self.assertEqual(self.selected(), [])

    def test_qualifiers_veto_temporally_contradictory_roster(self) -> None:
        for column, value in (('valid_to', '2021'), ('valid_from', '2027')):
            with self.subTest(column=column):
                self.db.execute(f'UPDATE facts SET {column}=? WHERE value_entity_id=10001', (value,))
                self.assertEqual(self.selected(), [])
                self.db.execute(f'UPDATE facts SET {column}=NULL WHERE value_entity_id=10001')
        self.db.execute("UPDATE facts SET valid_from='2026', valid_to='2026' WHERE value_entity_id=10001")
        self.assertEqual(len(self.selected()), 5)

    def test_absent_or_unreviewed_roster_proof_does_not_change_other_facts(self) -> None:
        self.db.execute('DELETE FROM fact_evidence WHERE source_revision_id=249')
        entities = _load_entities(self.db)
        facts, _ = _load_facts(self.db, entities)
        original = [(f.statement_id, f.predicate) for f in facts]
        self.assertEqual(grid_member_facts(self.db, facts, entities, date(2026, 10, 25)), [])
        self.assertEqual(original, [(f.statement_id, f.predicate) for f in facts])

    def test_same_name_in_another_group_does_not_make_roster_ambiguous(self) -> None:
        self.db.execute("INSERT INTO entities VALUES (11000, 'Q999999', 'person', 'Soyeon')")
        self.assertEqual(len(self.selected()), 5)

    def test_ambiguous_identity_inside_the_same_group_blocks_roster(self) -> None:
        self.db.execute("INSERT INTO entity_aliases VALUES (10002, 'en', 'Soyeon', 'alias')")
        self.assertEqual(self.selected(), [])

    def test_proof_does_not_borrow_a_members_other_revision(self) -> None:
        self.db.execute("UPDATE fact_evidence SET source_revision_id=248 WHERE fact_id=(SELECT id FROM facts WHERE value_entity_id=10001)")
        self.db.execute('INSERT INTO source_revisions VALUES (248, 249, 1374817864)')
        self.assertEqual(self.selected(), [])

    def test_unknown_extra_member_is_not_silently_treated_as_former(self) -> None:
        self.db.execute("UPDATE fact_evidence SET snippet='I-dle added member Soojin.' WHERE snippet LIKE '%departed%'")
        self.db.execute("UPDATE facts SET valid_to=NULL WHERE value_entity_id=10006")
        self.assertEqual(self.selected(), [])

    def test_positive_former_member_evidence_does_not_require_an_invented_end_date(self) -> None:
        self.db.execute("UPDATE facts SET valid_to=NULL WHERE value_entity_id=10006")
        self.assertEqual(len(self.selected()), 5)

    def test_another_persons_departure_does_not_prove_former_membership(self) -> None:
        self.db.execute("UPDATE fact_evidence SET snippet='Soojin joined I-dle after Jane left the group.' WHERE snippet LIKE '%departed%'")
        self.assertEqual(self.selected(), [])

    def test_departure_followed_by_return_is_not_unambiguous_former_proof(self) -> None:
        self.db.execute("UPDATE fact_evidence SET snippet='Soojin departed the group but rejoined later.' WHERE snippet LIKE '%departed%'")
        self.assertEqual(self.selected(), [])

    def add_current_claim(self, snippet: str = 'current_members = [[Soojin]]') -> None:
        self.db.execute("""
            INSERT INTO fact_evidence(fact_id, evidence_type, source_revision_id, source_key, locator, snippet)
            SELECT id, 'wikipedia_revision', 249, 'wikipedia:en',
                   'wikipedia:en:pageid=57057212:revid=1374817865#wikitext[10:20]', ?
            FROM facts WHERE value_entity_id=10006
        """, (snippet,))

    def test_historical_proof_does_not_silence_a_positive_current_claim(self) -> None:
        self.add_current_claim()
        self.assertEqual(self.selected(), [])

    def test_historical_field_next_to_the_normal_roster_still_counts(self) -> None:
        self.add_current_claim('past_members = [[Soojin]]')
        self.assertEqual(len(self.selected()), 5)

    def test_current_claim_in_another_revision_also_blocks_the_count(self) -> None:
        self.db.execute('INSERT INTO source_revisions VALUES (250, 249, 1381301828)')
        self.add_current_claim()
        self.db.execute('UPDATE fact_evidence SET source_revision_id=250 WHERE snippet LIKE ?', ('current_members%',))
        self.assertEqual(self.selected(), [])

    def test_former_member_proof_is_bounded_to_the_cited_revision(self) -> None:
        self.db.execute('INSERT INTO source_revisions VALUES (248, 249, 1374817864)')
        self.db.execute("UPDATE fact_evidence SET source_revision_id=248 WHERE snippet LIKE '%departed%'")
        self.assertEqual(self.selected(), [])

    def test_current_member_with_contemporary_former_proof_blocks_count(self):
        for snippet in ('past_members = [[Miyeon]]', 'Miyeon departed the group on May 1, 2024.'):
            with self.subTest(snippet=snippet):
                self.db.execute("DELETE FROM fact_evidence WHERE locator='conflict'")
                self.db.execute("""INSERT INTO fact_evidence(fact_id,evidence_type,source_revision_id,source_key,locator,snippet)
                    SELECT id,'wikipedia_revision',249,'wikipedia:en','conflict',? FROM facts WHERE value_entity_id=10005""", (snippet,))
                self.assertEqual(self.selected(), [])

    def test_former_claim_in_an_old_revision_does_not_veto_current_roster(self):
        self.db.execute('INSERT INTO source_revisions VALUES (248,249,1374817864)')
        self.db.execute("""INSERT INTO fact_evidence(fact_id,evidence_type,source_revision_id,source_key,locator,snippet)
            SELECT id,'wikipedia_revision',248,'wikipedia:en','old','past_members = [[Miyeon]]'
            FROM facts WHERE value_entity_id=10005""")
        self.assertEqual(len(self.selected()), 5)

    def add_agreeing_revision(self, local_id: int, external_id: int = 1381301828) -> None:
        """Repeat the whole cited list, with its former-member proof, in a newer revision."""
        self.db.execute('INSERT INTO source_revisions VALUES (?, 249, ?)', (local_id, external_id))
        self.db.execute("""
            INSERT INTO fact_evidence(fact_id, evidence_type, source_revision_id, source_key, locator, snippet)
            SELECT fact_id, evidence_type, ?, source_key, replace(locator, '1374817865', ?), snippet
            FROM fact_evidence WHERE source_revision_id=249
        """, (local_id, str(external_id)))

    def provenance(self):
        return sorted(
            (f.statement_id, tuple((e.revision_id, e.locator, e.source_url) for e in f.evidence))
            for f in self.selected()
        )

    def test_equivalent_databases_select_the_same_proof_whatever_the_local_ids(self) -> None:
        self.add_agreeing_revision(250)
        higher = self.provenance()
        self.setUp()
        self.add_agreeing_revision(100)
        lower = self.provenance()
        self.setUp()
        self.add_agreeing_revision(250)
        self.db.execute('UPDATE source_revisions SET id=id+5000')
        self.db.execute('UPDATE fact_evidence SET source_revision_id=source_revision_id+5000')
        shifted = self.provenance()

        self.assertEqual(len(higher), 5)
        self.assertEqual(higher, lower)
        self.assertEqual(higher, shifted)
        self.assertEqual({revision for _, evidence in higher for revision, _, _ in evidence}, {1381301828})


MONSTAX = Path(__file__).parent / 'fixtures' / 'grid-monstax-roster.json'
MONSTAX_INFOBOX = Path(__file__).parent / 'fixtures' / 'infobox-monstax-rev1375542648.json'
MONSTAX_SENTENCE = (
    'The group is currently composed of six members: Shownu, Minhyuk, Kihyun, Hyungwon, '
    'Joohoney, and I.M, while former member Wonho left the group in October 2019.'
)


class ClosedRosterWithDepartureTest(unittest.TestCase):
    """Monsta X, revision 1375542648: a closed roster that names who left.

    Wonho's statement stays ``conflict`` (Wikidata gives the end on one side
    only), so the count depends on the sentence being read as six members.
    """

    GROUP_ROW = 20000
    REVISION_ROW = 349

    def setUp(self) -> None:
        self.db = build_grid_test_database()
        self.addCleanup(self.db.close)
        self.source = json.loads(MONSTAX.read_text())
        self.db.execute("INSERT INTO entities VALUES (?, 'Q19855151', 'group', 'Monsta X')", (self.GROUP_ROW,))
        self.db.execute("INSERT INTO source_pages VALUES (?, 'wikipedia', 'en', 45409264)", (self.REVISION_ROW,))
        self.db.execute('INSERT INTO source_revisions VALUES (?, ?, 1375542648)', (self.REVISION_ROW, self.REVISION_ROW))
        self.rows = {}
        for index, member in enumerate(self.source['members'], self.GROUP_ROW + 1):
            self.rows[member['name']] = index
            self.db.execute('INSERT INTO entities VALUES (?, ?, ?, ?)',
                            (index, member['qid'], 'person', member['name']))
            for name in member['aliases']:
                self.db.execute("INSERT OR IGNORE INTO entity_aliases VALUES (?, 'en', ?, 'alias')", (index, name))
            cursor = self.db.execute("""
                INSERT INTO facts(statement_id, subject_entity_id, predicate, value_entity_id,
                                  status, quality_flags_json, status_reason)
                VALUES (?, ?, 'has_member', ?, ?, ?, ?)
            """, (member['statement_id'], self.GROUP_ROW, index, member['status'],
                  json.dumps(member['flags']),
                  None if member['status'] == 'accepted' else 'membership_period_unconfirmed'))
            self.db.execute("""
                INSERT INTO fact_evidence(fact_id, evidence_type, source_revision_id, source_key, locator, snippet)
                VALUES (?, 'wikipedia_revision', ?, 'wikipedia:en', ?, ?)
            """, (cursor.lastrowid, self.REVISION_ROW, member['locator'], member['snippet']))

    def selected(self):
        entities = _load_entities(self.db)
        facts, _ = _load_facts(self.db, entities)
        return grid_member_facts(self.db, facts, entities, date(2026, 10, 28))

    def set_sentence(self, sentence):
        self.db.execute('UPDATE fact_evidence SET snippet=?', (sentence,))

    def test_the_recorded_sentence_is_the_one_fixture_evidence(self):
        self.assertEqual({m['snippet'] for m in self.source['members']}, {MONSTAX_SENTENCE})

    def test_six_current_members_count_and_wonho_is_not_one_of_them(self):
        selected = self.selected()
        self.assertEqual(
            {f.value_entity.name('en') for f in selected},
            {'Shownu', 'Minhyuk', 'Kihyun', 'Hyung-won', 'Lee Jooheon', 'I.M'},
        )
        self.assertTrue(all(e.revision_id == 1375542648 for f in selected for e in f.evidence))
        criteria, evidence, _ = evaluate_group_criteria(
            selected, {'Q19855151': selected[0].subject}, {'Q19855151'}
        )
        self.assertIn('members_6', criteria['Q19855151'])
        self.assertIn('members_ge_6', criteria['Q19855151'])
        self.assertNotIn('members_7', criteria['Q19855151'])
        self.assertEqual(len(evidence[('Q19855151', 'members_6')]), 6)

    def test_the_starship_by_six_cell_admits_the_group_with_both_proofs_from_the_revision(self):
        infobox = json.loads(MONSTAX_INFOBOX.read_text())
        page = WikipediaPage(
            1, 'en', infobox['page_id'], infobox['revision_id'], MONSTAX_SENTENCE, 'Monsta X',
            ' ' * infobox['excerpt_offset'] + infobox['wikitext_excerpt'],
        )
        item = infobox_evidence(page, INFOBOX_LABEL_FIELDS, ['Starship Entertainment'])
        self.assertEqual(item.locator, 'wikipedia:en:pageid=45409264:revid=1375542648#wikitext[1156:1191]')
        selected = self.selected()
        group = selected[0].subject
        starship = Entity('Q255363', 'organization', 'Starship Entertainment', {'en': 'Starship Entertainment'})
        label = Fact(
            'label-starship', group, 'record_label', starship, None, None, None, None, None, None, (),
            (Evidence('label-starship', item.source_key, item.locator, infobox['source_url'], infobox['revision_id']),),
        )
        criteria, _, _ = evaluate_group_criteria(selected + [label], {group.wikidata_id: group}, {group.wikidata_id})
        self.assertTrue({'label_starship', 'members_6'} <= criteria['Q19855151'])
        self.assertFalse({'members_5', 'members_7'} & criteria['Q19855151'])

    def test_the_departure_stays_in_the_database_and_never_enters_the_count(self):
        self.selected()
        status = self.db.execute(
            'SELECT status FROM facts WHERE value_entity_id=?', (self.rows['Wonho'],)
        ).fetchone()[0]
        self.assertEqual(status, 'conflict')

    def test_a_positive_current_claim_for_the_departed_member_blocks_the_count(self):
        fact = self.db.execute(
            'SELECT id FROM facts WHERE value_entity_id=?', (self.rows['Wonho'],)
        ).fetchone()[0]
        self.db.execute("""
            INSERT INTO fact_evidence(fact_id, evidence_type, source_revision_id, source_key, locator, snippet)
            VALUES (?, 'wikipedia_revision', ?, 'wikipedia:en', 'wikipedia:en:pageid=45409264:revid=1375542648#wikitext[1:2]',
                    'current_members = [[Wonho]]')
        """, (fact, self.REVISION_ROW))
        self.assertEqual(self.selected(), [])

    def test_departure_without_proof_in_the_cited_revision_blocks_the_count(self):
        self.set_sentence(MONSTAX_SENTENCE.replace('Wonho left', 'Someone left'))
        self.assertEqual(self.selected(), [])

    def test_departure_clauses_that_are_not_a_plain_exit_fail_closed(self):
        for sentence in (
            MONSTAX_SENTENCE.replace('left the group', 'will leave the group'),
            MONSTAX_SENTENCE.replace('left the group', 'rejoined the group'),
            MONSTAX_SENTENCE.replace('while former member Wonho', 'while former member Joohoney'),
            MONSTAX_SENTENCE.replace('six members', 'seven members'),
            MONSTAX_SENTENCE.replace('2019.', '2019, and more may follow.'),
            MONSTAX_SENTENCE.replace('I.M, while', 'I.M and Ghost, while'),
        ):
            with self.subTest(sentence=sentence):
                self.set_sentence(sentence)
                self.assertEqual(self.selected(), [])

    def test_a_past_tense_roster_is_not_a_current_roster(self):
        self.set_sentence(MONSTAX_SENTENCE.replace('is currently composed of', 'was composed of'))
        self.assertEqual(self.selected(), [])
