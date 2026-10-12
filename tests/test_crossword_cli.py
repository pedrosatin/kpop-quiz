"""The public pilot CLI rejects malformed publication and reads SQLite read-only."""
import copy
import hashlib
from urllib.parse import urlparse, parse_qs
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / 'web/public/data/crossword-pilot.json'

def checksum(p):
    p['dataset_version']=hashlib.sha256(json.dumps({k:v for k,v in p.items() if k!='dataset_version'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class CrosswordCliTests(unittest.TestCase):

    def run_cli(self, *args):
        return subprocess.run([sys.executable, '-m', 'kpop_scraping.crossword_cli', *map(str, args)], cwd=ROOT, capture_output=True, text=True)

    def test_published_example_and_significant_digits(self):
        self.assertEqual(self.run_cli('--verify', PILOT).returncode, 0)
        p = json.loads(PILOT.read_text())
        entry = p['entries'][1]
        entry['canonical_name'] = 'Bt0B'
        entry['answer'] = 'BT0B'
        for cell in p['cells']:
            if cell['row'] == 2 and cell['col'] == 0:
                cell['answer'] = '0'
        with tempfile.TemporaryDirectory() as d:
            checksum(p)
            artifact = Path(d) / 'pilot.json'
            artifact.write_text(json.dumps(p))
            self.assertEqual(self.run_cli('--verify', artifact).returncode, 0)

    def test_invalid_content_is_rejected(self):
        base = json.loads(PILOT.read_text())
        for change in ['evidence', 'crossing', 'alias', 'orphan', 'vocabulary', 'clue', 'bounds', 'date', 'checksum', 'revision']:
            p = copy.deepcopy(base)
            if change == 'evidence':
                p['entries'][0]['sources'] = []
            if change == 'crossing':
                p['entries'][1]['answer'] = 'ATOB'
                p['entries'][1]['canonical_name'] = 'ATOB'
            if change == 'alias':
                p['entries'][1]['aliases'].append('BTS')
            if change == 'orphan':
                p['cells'].append({'row': 5, 'col': 0, 'answer': 'A'})
            if change == 'vocabulary':
                p['vocabulary'] = []
            if change == 'clue':
                p['entries'][0]['matching_qids'].append('Q123')
            if change == 'bounds':
                p['rows'] = 10
            if change == 'date': p['reference_date'] = '2026-02-31'
            if change == 'checksum': p['dataset_version'] = '0'*64
            if change == 'revision': p['entries'][0]['sources'][0]['locator'] = p['entries'][0]['sources'][0]['locator'].replace('revid=', 'revid=9')
            if change != 'checksum': checksum(p)
            with self.subTest(change=change), tempfile.TemporaryDirectory() as d:
                artifact = Path(d) / 'pilot.json'
                artifact.write_text(json.dumps(p))
                self.assertNotEqual(self.run_cli('--verify', artifact).returncode, 0)

    def test_impossible_or_empty_evidence_span_rejected_after_rehash(self):
        for span in ('999999:0', '10:10'):
            p = json.loads(PILOT.read_text())
            source = p['entries'][0]['sources'][0]
            source['locator'] = source['locator'].split('#')[0] + f'#wikitext[{span}]'
            checksum(p)
            with self.subTest(span=span), tempfile.TemporaryDirectory() as d:
                artifact = Path(d) / 'pilot.json'
                artifact.write_text(json.dumps(p))
                self.assertNotEqual(self.run_cli('--verify', artifact).returncode, 0)

    def test_selection_is_reproducible_and_read_only(self):
        p = json.loads(PILOT.read_text())
        with tempfile.TemporaryDirectory() as d:
            database = Path(d) / 'facts.db'
            c = sqlite3.connect(database)
            c.executescript('\n                CREATE TABLE entities(id INTEGER, wikidata_id TEXT, canonical_name TEXT, entity_type TEXT);\n                CREATE TABLE entity_aliases(entity_id INTEGER, name TEXT);\n                CREATE TABLE facts(id INTEGER, subject_entity_id INTEGER, value_entity_id INTEGER, predicate TEXT, status TEXT, value_time TEXT, statement_id TEXT);\n                CREATE TABLE source_revisions(id INTEGER, external_revision_id INTEGER, source_page_id INTEGER);\n                CREATE TABLE source_pages(id INTEGER, language TEXT, external_page_id INTEGER);\n                CREATE TABLE fact_evidence(fact_id INTEGER, source_revision_id INTEGER, evidence_type TEXT, locator TEXT, snippet TEXT);\n            ')
            fact_id = 0
            for entity_id, e in enumerate(p['entries'], 1):
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (entity_id, e['qid'], e['canonical_name'], 'group'))
                for alias in e['aliases']:
                    c.execute('INSERT INTO entity_aliases VALUES(?,?)', (entity_id, alias))
                for s in e['sources']:
                    fact_id += 1
                    target_id = 100 + fact_id
                    target = None if s['predicate'] == 'formed_on' else target_id
                    if target:
                        c.execute('INSERT INTO entities VALUES(?,?,?,?)', (target_id, f'Q{target_id}', s['value'], 'person'))
                    c.execute('INSERT INTO facts VALUES(?,?,?,?,?,?,?)', (fact_id, entity_id, target, s['predicate'], 'accepted', s['value'] if target is None else None, s['statement_id']))
                    url=urlparse(s['url']);query=parse_qs(url.query)
                    c.execute('INSERT INTO source_pages VALUES(?,?,?)',(fact_id,url.hostname.split('.')[0],int(query['curid'][0])))
                    c.execute('INSERT INTO source_revisions VALUES(?,?,?)', (fact_id,int(query['oldid'][0]),fact_id))
                    c.execute('INSERT INTO fact_evidence VALUES(?,?,?,?,?)', (fact_id, fact_id, 'wikipedia_revision', s['locator'], s['snippet']))
            c.commit()
            c.close()
            before = database.read_bytes()
            output = Path(d) / 'out.json'
            result = self.run_cli('--database', database, '--output', output)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            first = output.read_bytes()
            self.assertEqual(self.run_cli('--database', database, '--output', output).returncode, 0)
            self.assertEqual(output.read_bytes(), first)
            self.assertEqual(database.read_bytes(), before)
            self.assertNotEqual(self.run_cli('--database',database,'--output',database).returncode,0)
            alias = Path(d)/'database-link';alias.symlink_to(database)
            self.assertNotEqual(self.run_cli('--database',database,'--output',alias).returncode,0)
            self.assertEqual(database.read_bytes(),before)
            c=sqlite3.connect(database)
            c.execute("INSERT INTO facts SELECT 999,subject_entity_id,value_entity_id,predicate,'conflict',value_time,statement_id||'-conflict' FROM facts WHERE id=2")
            c.commit();c.close()
            self.assertNotEqual(self.run_cli('--database',database,'--output',output).returncode,0)
            c = sqlite3.connect(database)
            c.execute("UPDATE facts SET status='rejected' WHERE id=1")
            c.commit()
            c.close()
            self.assertNotEqual(self.run_cli('--database', database, '--output', output).returncode, 0)
            self.assertEqual(output.read_bytes(), first)
