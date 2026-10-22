"""Synthetic deterministic fixtures; no real database or network dependencies."""
import copy
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.crossword_daily import (DEFAULT_LIMITS, generate, history_context,
                                         next_context, validate)
from kpop_scraping.crossword_daily_cli import benchmark, protected_output
from kpop_scraping.crossword_daily_layout import (BudgetExhausted, canonical_board,
                                                count_assignments, geometry)
from kpop_scraping.crossword_daily_repository import FactBase, clue_text, digest, load_base
from kpop_scraping.crossword_cli import normalize, validate_source

ROOT = Path(__file__).resolve().parents[1]
DAY = '2026-10-21'
BOOT = dict(state='bootstrap', date=DAY, qids=[])


def fixture():
    groups, sources, matches = {}, {}, {}
    for i, name in enumerate([word + str(i % 10) for i, word in enumerate(
            ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
             'INDIA', 'JULIET', 'KILO', 'LIMA', 'MANGO', 'NOVEMBER', 'OSCAR', 'PAPA',
             'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY',
             'XRAY', 'YANKEE', 'ZULU'])], 1):
        qid = f'Q{i}'
        groups[qid] = dict(canonical_name=name, aliases=[name.lower()])
        source = dict(url=f'https://en.wikipedia.org/w/index.php?curid={i}&oldid={i}',
                      locator=f'wikipedia:en:pageid={i}:revid={i}#wikitext[0:10]',
                      snippet=f'Documented membership {i}', statement_id=f'{qid}$fixture',
                      predicate='has_member', value=f'Member {i}')
        sources[qid] = [source]
        matches['has_member', source['value']] = {qid}
    return FactBase(groups, matches, sources)


def rehash(p):
    p['dataset_version'] = digest({k: v for k, v in p.items() if k != 'dataset_version'})


class DailyCrosswordTests(unittest.TestCase):
    def setUp(self):
        self.base = fixture()
        self.p = generate(self.base, DAY, 'fixture', BOOT)
        self.assertEqual(self.p['status'], 'ready')

    def test_deterministic_bytes_and_seed_date_variation(self):
        first = json.dumps(self.p, sort_keys=True).encode()
        self.assertEqual(first, json.dumps(generate(self.base, DAY, 'fixture', BOOT), sort_keys=True).encode())
        other = generate(self.base, DAY, 'different', BOOT)
        self.assertNotEqual(self.p['puzzle'], other['puzzle'])
        context = dict(state='bootstrap', date='2026-10-22', qids=[])
        self.assertNotEqual(self.p['dataset_version'], generate(self.base, '2026-10-22', 'fixture', context)['dataset_version'])
        reordered = copy.deepcopy(self.base)
        reordered.groups = dict(reversed(list(reordered.groups.items())))
        self.assertEqual(self.p, generate(reordered, DAY, 'fixture', BOOT))

    def test_previous_day_exclusion_and_order_canonicalization(self):
        context = next_context(self.p, self.base)
        p = generate(self.base, '2026-10-22', 'fixture', context)
        self.assertEqual(p['status'], 'ready')
        self.assertFalse(set(context['qids']) & set(p['puzzle']['vocabulary']))
        context['qids'].reverse()
        self.assertEqual(p, generate(self.base, '2026-10-22', 'fixture', context))
        changed = dict(state='omitted', date=DAY, qids=[])
        self.assertNotEqual(p['dataset_version'], generate(self.base, '2026-10-22', 'fixture', changed)['dataset_version'])

    def test_explicit_bootstrap_omission_and_missing_history(self):
        for context in [None, {}, dict(state='missing', date='2026-10-20', qids=[]),
                        dict(state='played', date='2026-10-20', qids=[]),
                        dict(state='omitted', date='2026-10-20', qids=['Q1'])]:
            with self.subTest(context=context), self.assertRaises(ValueError):
                generate(self.base, DAY, 'fixture', context)
        context = dict(state='omitted', date='2026-10-20', qids=[])
        self.assertEqual(history_context(DAY, context), context)
        for day in ['2026-10-19', '2026-10-21', '2026-02-31', '2026-1-1']:
            with self.subTest(day=day), self.assertRaises(ValueError):
                generate(self.base, DAY, 'fixture', dict(context, date=day))
        with self.assertRaises(ValueError):
            generate(self.base, DAY, 'fixture', dict(BOOT, date='2026-10-20'))

    def test_all_universe_matching_precedes_length_filter(self):
        qid = self.p['puzzle']['entries'][0]['qid']
        self.base.groups['Q999'] = dict(canonical_name='Too long to fit in nine cells', aliases=[])
        atom = ('has_member', self.base.sources[qid][0]['value'])
        self.base.matches[atom].add('Q999')
        self.assertNotIn(qid, self.base.eligible())
        p = generate(self.base, DAY, 'fixture', BOOT)
        self.assertNotIn(qid, p['puzzle']['vocabulary'])
        # A forged singleton cannot override the recomputed index.
        old = copy.deepcopy(self.p)
        old['base_id'] = self.base.identity
        old['eligible_group_count'] = len(self.base.eligible())
        old['connected_group_count'] = len(self.base.eligible())
        old['puzzle']['audited_group_count'] = len(self.base.groups)
        rehash(old)
        with self.assertRaises(ValueError):
            validate(old, self.base)

    def test_alias_policy_is_within_game_and_digits_preserved(self):
        self.assertEqual(normalize('Áb-01!'), 'AB01')
        self.base.groups['Q999'] = dict(canonical_name='This canonical name is too long', aliases=[self.base.groups['Q1']['canonical_name']])
        self.assertIn('Q1', self.base.eligible())
        for g in self.base.groups.values():
            g['aliases'] = ['shared']
        p = generate(self.base, DAY, 'fixture', BOOT, dict(DEFAULT_LIMITS, attempts=3))
        self.assertEqual(p['status'], 'omitted')
        self.assertEqual(p['attempts'], 3)
        self.assertIsNone(p['puzzle'])
        self.assertEqual(sum(p['rejections'].values()), 3)
        self.assertEqual(next_context(p, self.base), dict(state='omitted', date=DAY, qids=[]))

    def test_formation_label_pair_uses_documented_relations(self):
        p = copy.deepcopy(self.p)
        e = p['puzzle']['entries'][0]
        qid = e['qid']
        original = self.base.sources[qid][0]
        sources = [dict(original, predicate='formed_on', value='2012-03-21', statement_id=qid + '$formed'),
                   dict(original, predicate='record_label', value='Historical Label', statement_id=qid + '$label')]
        self.base.sources[qid] = sources
        other = next(q for q in self.base.groups if q != qid)
        self.base.matches['formed_on', '2012-03-21'] = {qid, other}
        self.base.matches['record_label', 'Historical Label'] = {qid}
        self.assertEqual(self.base.clues(qid), [sources])
        e.update(sources=sources, clue=clue_text(sources))
        self.assertIn('2012-03-21', e['clue']['en'])
        self.assertIn('Documented record label', e['clue']['en'])
        p['base_id'] = self.base.identity
        rehash(p)
        validate(p, self.base)
        with self.assertRaises(ValueError):
            clue_text(sources[:1])

    def test_revision_locator_and_source_identity(self):
        s = copy.deepcopy(self.base.sources['Q1'][0])
        validate_source(s, 'Q1')
        for change in [dict(locator=s['locator'].replace('revid=1', 'revid=2')),
                       dict(locator=s['locator'].replace('[0:10]', '[10:10]')),
                       dict(statement_id='Q2$wrong'), dict(snippet='')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_source(dict(s, **change), 'Q1')
        for field in ['snippet', 'locator', 'value', 'statement_id']:
            b = copy.deepcopy(self.base)
            b.sources['Q1'][0][field] += 'changed'
            self.assertNotEqual(b.identity, self.base.identity)
        p = copy.deepcopy(self.p)
        p['puzzle']['entries'][0]['sources'][0]['snippet'] = 'Invented evidence'
        rehash(p)
        with self.assertRaisesRegex(ValueError, 'unverified source'):
            validate(p, self.base)

    def test_validation_recomputes_proof_and_counts(self):
        mutations = [lambda p: p['puzzle']['proof'].update(complete=False),
                     lambda p: p['puzzle']['proof'].update(nodes=99),
                     lambda p: p['puzzle']['proof'].update(solutions=True),
                     lambda p: p.update(eligible_group_count=999),
                     lambda p: p.update(attempts=True),
                     lambda p: p['puzzle'].update(rows=10),
                     lambda p: p['puzzle']['entries'][0].update(number=99),
                     lambda p: p['puzzle']['entries'][0]['matching_qids'].append('Q999'),
                     lambda p: p['puzzle']['cells'].append(dict(row=8, col=8, answer='X'))]
        for mutate in mutations:
            p = copy.deepcopy(self.p)
            mutate(p)
            rehash(p)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                validate(p, self.base)

    def test_budget_without_proof_omits_and_never_publishes_ready(self):
        p = generate(self.base, DAY, 'fixture', BOOT, dict(DEFAULT_LIMITS, attempts=200, proof_nodes=1))
        self.assertEqual(p['status'], 'omitted')
        self.assertGreater(p['rejections'].get('budget', 0), 0)
        self.assertEqual(sum(p['rejections'].values()), 200)
        p = copy.deepcopy(self.p)
        p['limits']['proof_nodes'] = 1
        rehash(p)
        with self.assertRaises(BudgetExhausted):
            validate(p, self.base)
        p = generate(self.base, DAY, 'fixture', BOOT, dict(DEFAULT_LIMITS, attempts=2, placement_nodes=1))
        self.assertEqual(p['status'], 'omitted')

    def test_schema_and_python_contract(self):
        schema = json.loads((ROOT / 'schemas/crossword-daily-v1.json').read_text())
        self.assertEqual(set(schema['required']), set(self.p))
        try:
            import fastjsonschema
        except ImportError:
            return
        check = fastjsonschema.compile(schema)
        check(self.p)
        p = generate(self.base, DAY, 'fixture', BOOT, dict(DEFAULT_LIMITS, attempts=1, proof_nodes=1))
        check(p)

    def test_benchmark_sequential_sample_and_output_protection(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / '.scratch' / 'run'
            report = benchmark(self.base, DAY, 3, 'fixture', BOOT, DEFAULT_LIMITS, out)
            self.assertEqual(report['days'], 3)
            self.assertTrue(report['consecutive_intersections_empty'])
            self.assertEqual(len(list(out.glob('2026-*.json'))), 3)
            source = Path(d) / 'source'
            source.write_text('protected')
            alias = Path(d) / 'alias'
            alias.symlink_to(source)
            hardlink = Path(d) / 'hardlink'
            hardlink.hardlink_to(source)
            for dest in [source, alias, hardlink]:
                with self.assertRaises(ValueError):
                    protected_output(dest, [source])


class GeometryAndSolverTests(unittest.TestCase):
    def test_undeclared_runs_parallel_overlap_and_disconnection(self):
        a = dict(qid='Q1', answer='ABC', row=0, col=0, direction='across')
        b = dict(qid='Q2', answer='DEF', row=1, col=0, direction='across')
        for entry in [b, dict(b, row=0, answer='ABC'), dict(b, row=4)]:
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                geometry([a, entry])
        with self.assertRaises(ValueError):
            geometry([dict(a, answer='ABCDEFGHIJ')])
        with self.assertRaises(ValueError):
            geometry([a, dict(b, col=3, row=0)])

    def test_multiple_assignments_counterexample_and_budget(self):
        entries = [dict(answer='AB', row=0, col=0, direction='across'),
                   dict(answer='AC', row=0, col=0, direction='down')]
        domains = [[('Q1', 'AB'), ('Q2', 'AD')], [('Q3', 'AC')]]
        self.assertEqual(count_assignments(entries, domains)['solutions'], 2)
        self.assertEqual(count_assignments(entries, [[('Q1', 'AB')], [('Q3', 'BC')]])['solutions'], 0)
        with self.assertRaises(BudgetExhausted):
            count_assignments(entries, domains, node_limit=1)
        self.assertEqual(count_assignments(entries, [[('Q1', 'AB')], [('Q3', 'AC')]])['solutions'], 1)
        # Alternate letters are considered despite the stored solution's letters.
        self.assertEqual(count_assignments(entries, [[('Q1', 'XY')], [('Q3', 'XZ')]])['solutions'], 1)


class RepositoryTests(unittest.TestCase):
    def test_readonly_loading_conflicts_ambiguity_and_cli(self):
        fixture_base = fixture()
        with tempfile.TemporaryDirectory() as d:
            database = Path(d) / 'facts.db'
            c = sqlite3.connect(database)
            c.executescript('''
                CREATE TABLE entities(id INTEGER, wikidata_id TEXT, canonical_name TEXT, entity_type TEXT);
                CREATE TABLE entity_aliases(entity_id INTEGER, name TEXT);
                CREATE TABLE facts(id INTEGER, subject_entity_id INTEGER, value_entity_id INTEGER, predicate TEXT, status TEXT, value_time TEXT, statement_id TEXT);
                CREATE TABLE source_revisions(id INTEGER, external_revision_id INTEGER, source_page_id INTEGER);
                CREATE TABLE source_pages(id INTEGER, language TEXT, external_page_id INTEGER);
                CREATE TABLE fact_evidence(fact_id INTEGER, source_revision_id INTEGER, evidence_type TEXT, locator TEXT, snippet TEXT);
            ''')
            for i, (qid, g) in enumerate(fixture_base.groups.items(), 1):
                s = fixture_base.sources[qid][0]
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (i, qid, g['canonical_name'], 'group'))
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (100 + i, f'Q{100+i}', s['value'], 'person'))
                c.execute('INSERT INTO entity_aliases VALUES(?,?)', (i, g['aliases'][0]))
                c.execute('INSERT INTO facts VALUES(?,?,?,?,?,?,?)', (i, i, 100 + i, 'has_member', 'accepted', None, s['statement_id']))
                c.execute('INSERT INTO source_pages VALUES(?,?,?)', (i, 'en', i))
                c.execute('INSERT INTO source_revisions VALUES(?,?,?)', (i, i, i))
                c.execute('INSERT INTO fact_evidence VALUES(?,?,?,?,?)', (i, i, 'wikipedia_revision', s['locator'], s['snippet']))
            # A long group with accepted evidence participates even without publishable revision evidence.
            c.execute("INSERT INTO entities VALUES(999,'Q999','Far too long for the crossword','group')")
            c.execute("INSERT INTO facts VALUES(999,999,101,'has_member','accepted',NULL,'Q999$fixture')")
            c.execute("INSERT INTO fact_evidence VALUES(999,1,'wikidata_reference','reference','evidence')")
            c.commit()
            c.close()
            before = database.read_bytes()
            base = load_base(database)
            self.assertEqual(len(base.groups), len(fixture_base.groups) + 1)
            self.assertEqual(base.matching(fixture_base.sources['Q1']), ['Q1', 'Q999'])
            self.assertNotIn('Q1', base.eligible())
            self.assertEqual(database.read_bytes(), before)
            output = Path(d) / 'daily.json'
            args = [sys.executable, '-m', 'kpop_scraping.crossword_daily_cli', '--database', str(database),
                    '--reference-date', DAY, '--bootstrap', '--output', str(output)]
            run = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            artifact = output.read_bytes()
            self.assertEqual(subprocess.run(args, cwd=ROOT, capture_output=True).returncode, 0)
            self.assertEqual(artifact, output.read_bytes())
            missing = subprocess.run([a for a in args if a != '--bootstrap'], cwd=ROOT, capture_output=True)
            self.assertEqual(missing.returncode, 1)
            self.assertEqual(artifact, output.read_bytes())
            overwrite = list(args)
            overwrite[-1] = str(database)
            self.assertEqual(subprocess.run(overwrite, cwd=ROOT, capture_output=True).returncode, 1)
            self.assertEqual(database.read_bytes(), before)
            verify = subprocess.run([*args[:5], '--verify', str(output)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(verify.returncode, 0, verify.stdout + verify.stderr)
            self.assertEqual(database.read_bytes(), before)
            c = sqlite3.connect(database)
            c.execute("INSERT INTO facts VALUES(1000,2,102,'has_member','conflict',NULL,'Q2$conflict')")
            c.commit(); c.close()
            self.assertNotIn('Q2', load_base(database).eligible())


if __name__ == '__main__':
    unittest.main()
