"""Select the audited crossword pilot from accepted facts; never collect data."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from datetime import date
from .quiz_schema import write_json_atomic
from .storage import canonical_json
from .quiz_repository import _has_open_conflict
SCHEMA = 'crossword-pilot-v1'
MODE = 'pilot'
PUZZLE_ID = 'crossword-audited-01'
MAX_SIDE = 9
MIN_ENTRIES, MAX_ENTRIES = 3, 5
# Field sets of schemas/crossword-pilot-v1.json (additionalProperties: false).
ROOT_KEYS = {'schema_version', 'mode', 'puzzle_id', 'dataset_version', 'reference_date', 'rows', 'cols', 'vocabulary', 'audited_group_count', 'entries', 'cells'}
ENTRY_KEYS = {'qid', 'canonical_name', 'aliases', 'answer', 'row', 'col', 'direction', 'number', 'clue', 'matching_qids', 'sources'}
SOURCE_KEYS = {'url', 'locator', 'snippet', 'statement_id', 'predicate', 'value'}
CELL_KEYS = {'row', 'col', 'answer'}
SELECTION = [('Q13580495', 0, 0, 'across', [('has_member', 'J-Hope')]), ('Q491067', 0, 0, 'down', [('formed_on', '2012'), ('record_label', 'Cube Entertainment')]), ('Q223048', 0, 2, 'down', [('formed_on', '2010'), ('record_label', 'Starship Entertainment')])]
CLUES = [{'pt-BR': 'Grupo que inclui J-Hope.', 'en': 'Group whose members include J-Hope.'}, {'pt-BR': 'Grupo formado em 2012. Gravadora: Cube Entertainment.', 'en': 'Group formed in 2012. Record label: Cube Entertainment.'}, {'pt-BR': 'Grupo formado em 2010. Gravadora: Starship Entertainment.', 'en': 'Group formed in 2010. Record label: Starship Entertainment.'}]

def normalize(name: str) -> str:
    return re.sub('[^A-Z0-9]', '', unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().upper())

def validate(p: dict) -> None:
    """Domain rules of crossword-pilot-v1; web/src/data/crossword.ts mirrors them."""
    if not isinstance(p, dict) or p.get('schema_version') != SCHEMA or p.get('mode') != MODE:
        raise ValueError('unsupported crossword')
    if set(p) != ROOT_KEYS:
        raise ValueError('unexpected fields')
    if p.get('puzzle_id') != PUZZLE_ID or not isinstance(p['dataset_version'], str) or not re.fullmatch('[a-f0-9]{64}', p['dataset_version']):
        raise ValueError('missing identity')
    if not isinstance(p['reference_date'], str) or not re.fullmatch('\\d{4}-\\d{2}-\\d{2}', p['reference_date']):
        raise ValueError('missing reference date')
    date.fromisoformat(p['reference_date'])
    if p['dataset_version'] != hashlib.sha256(canonical_json({k:v for k,v in p.items() if k != 'dataset_version'})).hexdigest():
        raise ValueError('dataset checksum mismatch')
    rows, cols = (p['rows'], p['cols'])
    if type(rows) is not int or type(cols) is not int or (not 1 <= rows <= MAX_SIDE) or (not 1 <= cols <= MAX_SIDE):
        raise ValueError('board bounds')
    entries = p['entries']
    if not isinstance(entries, list) or not MIN_ENTRIES <= len(entries) <= MAX_ENTRIES:
        raise ValueError('entry count')
    if type(p['audited_group_count']) is not int or p['audited_group_count'] < len(entries):
        raise ValueError('audited group count')
    if not isinstance(p['cells'], list) or any((not isinstance(c, dict) or set(c) != CELL_KEYS for c in p['cells'])):
        raise ValueError('unexpected fields')
    if any((type(c['row']) is not int or type(c['col']) is not int or not isinstance(c['answer'], str) for c in p['cells'])):
        raise ValueError('cell types')
    if not isinstance(p['vocabulary'], list):
        raise ValueError('vocabulary mismatch')
    cells, owners, aliases, ids = ({}, {}, {}, set())
    for e in entries:
        if not isinstance(e, dict) or set(e) != ENTRY_KEYS or not isinstance(e['clue'], dict) or set(e['clue']) != {'pt-BR', 'en'}:
            raise ValueError('unexpected fields')
        if not isinstance(e['aliases'], list) or not isinstance(e['sources'], list) or not isinstance(e['matching_qids'], list):
            raise ValueError('unexpected fields')
        if not isinstance(e['qid'], str) or not re.fullmatch('Q[1-9][0-9]*', e['qid']) or e['qid'] in ids:
            raise ValueError('identity')
        ids.add(e['qid'])
        if not isinstance(e['canonical_name'], str) or not isinstance(e['answer'], str) or not all(isinstance(a, str) for a in e['aliases']):
            raise ValueError('normalization')
        word = normalize(e['canonical_name'])
        if word != e['answer'] or not word:
            raise ValueError('normalization')
        if e['direction'] not in ('across', 'down'):
            raise ValueError('direction')
        if type(e['row']) is not int or type(e['col']) is not int or type(e['number']) is not int:
            raise ValueError('coordinates')
        for name in [e['canonical_name'], *e['aliases']]:
            alias = normalize(name)
            if alias and alias in aliases and (aliases[alias] != e['qid']):
                raise ValueError('ambiguous alias')
            aliases[alias] = e['qid']
        if not all((isinstance(e['clue'].get(lang), str) and e['clue'][lang].strip() for lang in ('pt-BR', 'en'))):
            raise ValueError('missing clue')
        if not e['sources']:
            raise ValueError('missing evidence')
        for source in e['sources']:
            if not isinstance(source, dict) or set(source) != SOURCE_KEYS or not all((isinstance(source[k], str) and source[k] for k in ('predicate', 'value', 'snippet'))):
                raise ValueError('invalid evidence')
            if not isinstance(source['url'], str) or not isinstance(source['locator'], str) or not isinstance(source['statement_id'], str):
                raise ValueError('invalid evidence')
            url = re.fullmatch(r'https://([a-z]{2,3}(?:-[a-z]+)?).wikipedia.org/w/index.php\?curid=([1-9][0-9]*)&oldid=([1-9][0-9]*)', source['url'])
            locator = re.fullmatch(r'wikipedia:([a-z]{2,3}(?:-[a-z]+)?):pageid=([1-9][0-9]*):revid=([1-9][0-9]*)#(?:extract|wikitext)\[(\d+):(\d+)\]', source['locator'])
            if not url or not locator or url.groups() != locator.groups()[:3] or int(locator[4]) >= int(locator[5]) or not source['statement_id'].startswith(e['qid']+'$'):
                raise ValueError('invalid evidence')
        for i, letter in enumerate(word):
            key = (e['row'] + (i if e['direction'] == 'down' else 0), e['col'] + (i if e['direction'] == 'across' else 0))
            if not (0 <= key[0] < rows and 0 <= key[1] < cols):
                raise ValueError('entry outside board')
            if key in cells and (cells[key] != letter or any((direction == e['direction'] for _, direction in owners[key]))):
                raise ValueError('invalid crossing')
            cells[key] = letter
            owners.setdefault(key, []).append((e['qid'], e['direction']))
    starts = sorted({(e['row'], e['col']) for e in entries})
    if any((e['number'] != starts.index((e['row'], e['col'])) + 1 for e in entries)):
        raise ValueError('numbering')
    reached = {entries[0]['qid']}
    for _ in entries:
        for group in owners.values():
            if any((q in reached for q, _ in group)):
                reached.update((q for q, _ in group))
    if reached != ids:
        raise ValueError('disconnected entries')
    if p['vocabulary'] != sorted(ids):
        raise ValueError('vocabulary mismatch')
    if any((len(e['matching_qids']) != 1 or e['matching_qids'][0] != e['qid'] for e in entries)):
        raise ValueError('ambiguous clue')
    if p['cells'] != [{'row': r, 'col': c, 'answer': v} for (r, c), v in sorted(cells.items())]:
        raise ValueError('orphan or missing cells')

def select(database: Path, reference_date: str) -> dict:
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        entries = []
        conflicts = c.execute("select * from facts where status='conflict'").fetchall()
        vocabulary = [r['wikidata_id'] for r in c.execute("select wikidata_id from entities where entity_type='group'")]
        for index, (qid, row, col, direction, predicates) in enumerate(SELECTION):
            entity = c.execute('select * from entities where wikidata_id=?', (qid,)).fetchone()
            if entity is None:
                raise ValueError(f'missing selected entity {qid}')
            sources = []
            matches = set(vocabulary)
            for predicate, value in predicates:
                candidates = c.execute("select f.*,e.wikidata_id,coalesce(f.value_time,v.canonical_name) value from facts f join entities e on e.id=f.subject_entity_id left join entities v on v.id=f.value_entity_id where f.status='accepted' and f.predicate=?", (predicate,)).fetchall()
                candidates = [r for r in candidates if not _has_open_conflict(r, conflicts) and c.execute("select 1 from fact_evidence where fact_id=? limit 1", (r['id'],)).fetchone()]
                matches &= {r['wikidata_id'] for r in candidates if r['value'] == value}
                selected = [r for r in candidates if r['wikidata_id'] == qid and r['value'] == value]
                if not selected:
                    raise ValueError(f'missing accepted fact {qid} {predicate}')
                fact = selected[0]
                ev = c.execute("select fe.*,sr.external_revision_id,sp.language,sp.external_page_id from fact_evidence fe join source_revisions sr on sr.id=fe.source_revision_id join source_pages sp on sp.id=sr.source_page_id where fe.fact_id=? and fe.evidence_type='wikipedia_revision' order by fe.locator limit 1", (fact['id'],)).fetchone()
                if ev is None:
                    raise ValueError(f'missing revision evidence {qid}')
                sources.append({'url': f"https://{ev['language']}.wikipedia.org/w/index.php?curid={ev['external_page_id']}&oldid={ev['external_revision_id']}", 'locator': ev['locator'], 'snippet': ev['snippet'], 'statement_id': fact['statement_id'], 'predicate': predicate, 'value': value})
            if matches != {qid}:
                raise ValueError(f'ambiguous factual clue {qid}: {sorted(matches)}')
            entries.append({'qid': qid, 'canonical_name': entity['canonical_name'], 'aliases': [r[0] for r in c.execute('select name from entity_aliases where entity_id=?', (entity['id'],))], 'answer': normalize(entity['canonical_name']), 'row': row, 'col': col, 'direction': direction, 'number': 1 if col == 0 else 2, 'clue': CLUES[index], 'sources': sources, 'matching_qids': sorted(matches)})
    cells = {}
    for e in entries:
        for i, l in enumerate(e['answer']):
            cells[e['row'] + (i if e['direction'] == 'down' else 0), e['col'] + (i if e['direction'] == 'across' else 0)] = l
    payload = {'schema_version': SCHEMA, 'mode': MODE, 'puzzle_id': PUZZLE_ID, 'reference_date': reference_date, 'rows': 6, 'cols': 3, 'vocabulary': sorted((q for q, *_ in SELECTION)), 'audited_group_count': len(vocabulary), 'entries': entries, 'cells': [{'row': r, 'col': c, 'answer': v} for (r, c), v in sorted(cells.items())]}
    payload['dataset_version'] = hashlib.sha256(canonical_json(payload)).hexdigest()
    validate(payload)
    return payload

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--reference-date', default='2026-10-12')
    args = parser.parse_args()
    try:
        if args.verify:
            validate(json.loads(args.verify.read_text()))
            print('crossword pilot valid')
            return 0
        if not args.database or not args.output:
            parser.error('--database and --output required for selection')
        if args.database.resolve() == args.output.resolve() or (args.output.exists() and args.database.samefile(args.output)):
            raise ValueError('output must not overwrite the source database')
        p = select(args.database, args.reference_date)
        write_json_atomic(args.output, p, validate)
        print(f"Selected {len(p['entries'])} cited entries; audited {p['audited_group_count']} groups")
        return 0
    except (ValueError, KeyError, TypeError, AttributeError, IndexError, sqlite3.Error, OSError) as e:
        print(f'crossword pilot rejected: {e}')
        return 1
if __name__ == '__main__':
    raise SystemExit(main())
