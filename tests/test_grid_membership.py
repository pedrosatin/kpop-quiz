"""Regression coverage for revision-bounded current grid member counts."""

from __future__ import annotations

import json
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping.grid_generator import evaluate_group_criteria
from kpop_scraping.grid_membership import grid_member_facts
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
