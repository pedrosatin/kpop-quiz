"""Offline factual universe for daily crosswords (including ineligible lengths)."""
from __future__ import annotations

import hashlib
import itertools
import sqlite3
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from .crossword_cli import normalize, validate_source
from .quiz_repository import _has_open_conflict
from .storage import canonical_json

PREDICATES = {'has_member', 'formed_on', 'record_label'}


def digest(value) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def clue_text(sources: list[dict]) -> dict:
    """Describe documented relations without claiming a current affiliation."""
    atoms = {s['predicate']: s['value'] for s in sources}
    if len(sources) == 1 and set(atoms) == {'has_member'}:
        member = atoms['has_member']
        return {'pt-BR': f'Grupo com participação documentada de {member}.',
                'en': f'Group with documented membership of {member}.'}
    if len(sources) == 2 and set(atoms) == {'formed_on', 'record_label'}:
        formed, label = atoms['formed_on'], atoms['record_label']
        return {'pt-BR': f'Grupo formado em {formed}. Gravadora documentada: {label}.',
                'en': f'Group formed in {formed}. Documented record label: {label}.'}
    raise ValueError('unsupported clue template')


@dataclass
class FactBase:
    groups: dict[str, dict]
    matches: dict[tuple[str, str], set[str]]
    sources: dict[str, list[dict]]

    @property
    def identity(self) -> str:
        return digest({'groups': self.groups,
                       'matches': [[*a, sorted(q)] for a, q in sorted(self.matches.items())],
                       'sources': self.sources})

    def matching(self, sources: list[dict]) -> list[str]:
        return sorted(set.intersection(*(self.matches.get((s['predicate'], s['value']), set())
                                        for s in sources))) if sources else []

    def clues(self, qid: str) -> list[list[dict]]:
        own = self.sources.get(qid, [])
        members = [[s] for s in own if s['predicate'] == 'has_member']
        pairs = [[a, b] for a, b in itertools.product(own, own)
                 if a['predicate'] == 'formed_on' and b['predicate'] == 'record_label']
        return [ss for ss in members + pairs if self.matching(ss) == [qid]]

    def eligible(self, excluded=()) -> dict[str, dict]:
        return {q: g for q, g in sorted(self.groups.items())
                if q not in excluded and 1 <= len(normalize(g['canonical_name'])) <= 9
                and self.clues(q)}


def load_base(database: Path) -> FactBase:
    """Read a consistent SQLite snapshot; no migrations or network calls."""
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as c:
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA query_only=ON')
        c.execute('BEGIN')
        groups = {}

        aliases_by_id = defaultdict(set)
        for entity_id, name in c.execute('''
            SELECT a.entity_id, a.name
            FROM entity_aliases a
            JOIN entities e ON e.id = a.entity_id
            WHERE e.entity_type='group'
        ''').fetchall():
            aliases_by_id[entity_id].add(name)

        for r in c.execute("SELECT * FROM entities WHERE entity_type='group' ORDER BY wikidata_id").fetchall():
            groups[r['wikidata_id']] = {
                'canonical_name': r['canonical_name'],
                'aliases': sorted(aliases_by_id[r['id']])
            }
        conflicts = c.execute("SELECT * FROM facts WHERE status='conflict'").fetchall()
        matches, sources = defaultdict(set), defaultdict(list)
        rows = c.execute("""SELECT f.*,e.wikidata_id,coalesce(f.value_time,v.canonical_name) value
            FROM facts f JOIN entities e ON e.id=f.subject_entity_id
            LEFT JOIN entities v ON v.id=f.value_entity_id ORDER BY f.statement_id""").fetchall()
        for r in rows:
            qid = r['wikidata_id']
            if (qid not in groups or r['predicate'] not in PREDICATES or r['status'] != 'accepted'
                    or _has_open_conflict(r, conflicts) or not isinstance(r['value'], str)):
                continue
            if not c.execute('SELECT 1 FROM fact_evidence WHERE fact_id=? LIMIT 1', (r['id'],)).fetchone():
                continue
            matches[r['predicate'], r['value']].add(qid)
            evidence = c.execute("""SELECT fe.*,sr.external_revision_id,sp.language,sp.external_page_id
                FROM fact_evidence fe JOIN source_revisions sr ON sr.id=fe.source_revision_id
                JOIN source_pages sp ON sp.id=sr.source_page_id
                WHERE fe.fact_id=? AND fe.evidence_type='wikipedia_revision'
                ORDER BY fe.locator,fe.snippet,sr.external_revision_id,sp.external_page_id""", (r['id'],))
            for ev in evidence:
                source = {'url': f"https://{ev['language']}.wikipedia.org/w/index.php?curid={ev['external_page_id']}&oldid={ev['external_revision_id']}",
                          'locator': ev['locator'], 'snippet': ev['snippet'], 'statement_id': r['statement_id'],
                          'predicate': r['predicate'], 'value': r['value']}
                try:
                    validate_source(source, qid)
                except ValueError:
                    continue
                sources[qid].append(source)
        # Canonical order and deduplication make database insertion order irrelevant.
        ordered = {q: sorted({canonical_json(s): s for s in ss}.values(), key=canonical_json)
                   for q, ss in sorted(sources.items())}
        return FactBase(groups, dict(matches), ordered)
