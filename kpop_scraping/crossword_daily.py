"""Daily crossword contract and deterministic offline generation, independent of publication."""
from __future__ import annotations

import copy
import random
import re
from collections import Counter
from datetime import date, timedelta

from . import crossword_cli as pilot
from .crossword_daily_layout import (BudgetExhausted, canonical_board, connected_count,
                                     count_assignments, place)
from .crossword_daily_repository import FactBase, clue_text, digest

SCHEMA = 'crossword-daily-v1'
DEFAULT_LIMITS = {'attempts': 200, 'placement_nodes': 5000, 'proof_nodes': 10000}
ROOT_KEYS = {'schema_version', 'reference_date', 'seed', 'base_id', 'previous', 'limits',
             'status', 'attempts', 'rejections', 'eligible_group_count', 'connected_group_count',
             'puzzle', 'dataset_version'}


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('invalid date')
    return date.fromisoformat(value)


def history_context(reference_date: str, previous: dict) -> dict:
    day = valid_date(reference_date)
    if not isinstance(previous, dict) or set(previous) != {'state', 'date', 'qids'}:
        raise ValueError('explicit previous-day context required')
    state, qids = previous['state'], previous['qids']
    expected = day if state == 'bootstrap' else day - timedelta(days=1)
    if valid_date(previous['date']) != expected:
        raise ValueError('previous-day date mismatch')
    if state not in {'bootstrap', 'played', 'omitted'}:
        raise ValueError('missing or unknown previous-day history')
    if (not isinstance(qids, list) or any(not isinstance(q, str) or not re.fullmatch(r'Q[1-9][0-9]*', q)
                                          for q in qids) or len(set(qids)) != len(qids)):
        raise ValueError('invalid historical QIDs')
    if (state == 'played' and not 3 <= len(qids) <= 5) or (state != 'played' and qids):
        raise ValueError('history state and QIDs disagree')
    return dict(state=state, date=expected.isoformat(), qids=sorted(qids))


def next_context(artifact: dict, base: FactBase) -> dict:
    """Validate a previous artifact before deriving its played/omitted context."""
    validate(artifact, base)
    return {'state': 'played' if artifact['status'] == 'ready' else 'omitted',
            'date': artifact['reference_date'],
            'qids': artifact['puzzle']['vocabulary'] if artifact['puzzle'] else []}


def limits_checked(limits):
    if not isinstance(limits, dict) or set(limits) != set(DEFAULT_LIMITS) or any(
            type(v) is not int or v < 1 or v > 1000000 for v in limits.values()):
        raise ValueError('invalid generation budgets')
    return limits


def domains_for(entries, base):
    return [[(q, pilot.normalize(base.groups[q]['canonical_name']))
             for q in base.matching(e['sources'])] for e in entries]


def check_board(board, reference_date):
    """Board rules that need no fact base: shape, geometry, numbering and proof form."""
    if not isinstance(board, dict) or set(board) != {
            'rows', 'cols', 'entries', 'vocabulary', 'cells', 'audited_group_count', 'proof'}:
        raise ValueError('unexpected board fields')
    # Reuse all existing alias, evidence, numbering, cell and connectivity rules.
    probe = {k: v for k, v in board.items() if k != 'proof'}
    probe.update(schema_version=pilot.SCHEMA, mode=pilot.MODE, puzzle_id=pilot.PUZZLE_ID,
                 reference_date=reference_date)
    probe['dataset_version'] = digest(probe)
    pilot.validate(probe)
    canonical = canonical_board(board['entries'])
    if any(board[k] != v for k, v in canonical.items()):
        raise ValueError('noncanonical board')
    stored_proof = board['proof']
    if (not isinstance(stored_proof, dict) or set(stored_proof) != {'solutions', 'complete', 'nodes'}
            or type(stored_proof['solutions']) is not int or type(stored_proof['nodes']) is not int
            or stored_proof['complete'] is not True or stored_proof['solutions'] != 1):
        raise ValueError('invalid proof')


def validate_board(board, reference_date, base, proof_nodes):
    check_board(board, reference_date)
    if board['audited_group_count'] != len(base.groups):
        raise ValueError('factual universe mismatch')
    for e in board['entries']:
        g = base.groups.get(e['qid'])
        if not g or e['canonical_name'] != g['canonical_name'] or e['aliases'] != g['aliases']:
            raise ValueError('group differs from base')
        if any(s not in base.sources.get(e['qid'], []) for s in e['sources']):
            raise ValueError('unverified source')
        if e['clue'] != clue_text(e['sources']) or e['matching_qids'] != base.matching(e['sources']):
            raise ValueError('factual clue mismatch')
    proof = count_assignments(board['entries'], domains_for(board['entries'], base), proof_nodes)
    if proof['solutions'] != 1 or board['proof'] != proof:
        raise ValueError('unique assignment not proven')


def validate_published(p: dict) -> None:
    """Rules a publisher can check without the fact base.

    Checksum, history, budgets, attempt accounting, board geometry and the
    previous-day exclusion. The factual matching and the proof search need the
    base and stay in ``validate``; the daily runner runs both before writing.
    """
    if not isinstance(p, dict) or set(p) != ROOT_KEYS or p['schema_version'] != SCHEMA:
        raise ValueError('unsupported daily crossword')
    valid_date(p['reference_date'])
    if not isinstance(p['seed'], str) or not p['seed']:
        raise ValueError('missing seed')
    if not isinstance(p['base_id'], str) or not re.fullmatch(r'[0-9a-f]{64}', p['base_id']):
        raise ValueError('fact base mismatch')
    if p['dataset_version'] != digest({k: v for k, v in p.items() if k != 'dataset_version'}):
        raise ValueError('dataset checksum mismatch')
    previous = history_context(p['reference_date'], p['previous'])
    if previous != p['previous']:
        raise ValueError('noncanonical history')
    limits = limits_checked(p['limits'])
    if type(p['eligible_group_count']) is not int or type(p['connected_group_count']) is not int:
        raise ValueError('eligibility counts mismatch')
    if type(p['attempts']) is not int or not 1 <= p['attempts'] <= limits['attempts']:
        raise ValueError('invalid attempt count')
    if not isinstance(p['rejections'], dict) or any(
            k not in {'placement', 'budget', 'validation'} or type(v) is not int or v < 1
            for k, v in p['rejections'].items()):
        raise ValueError('invalid rejection counts')
    if p['status'] == 'omitted':
        if p['puzzle'] is not None or p['attempts'] != limits['attempts'] or sum(p['rejections'].values()) != p['attempts']:
            raise ValueError('invalid omission')
    elif p['status'] == 'ready':
        if sum(p['rejections'].values()) != p['attempts'] - 1:
            raise ValueError('attempt accounting')
        check_board(p['puzzle'], p['reference_date'])
        if set(p['puzzle']['vocabulary']) & set(previous['qids']):
            raise ValueError('ineligible or consecutive group')
    else:
        raise ValueError('unknown daily status')


def validate(p: dict, base: FactBase) -> None:
    """Recompute factual matching and bounded proof; checksum alone is insufficient."""
    validate_published(p)
    if p['base_id'] != base.identity:
        raise ValueError('fact base mismatch')
    eligible = base.eligible(p['previous']['qids'])
    if (p['eligible_group_count'] != len(eligible)
            or p['connected_group_count'] != connected_count(eligible)):
        raise ValueError('eligibility counts mismatch')
    if p['status'] == 'ready':
        validate_board(p['puzzle'], p['reference_date'], base, p['limits']['proof_nodes'])
        if set(p['puzzle']['vocabulary']) - set(eligible):
            raise ValueError('ineligible or consecutive group')


def generate(base: FactBase, reference_date: str, seed: str, previous: dict,
             limits: dict | None = None) -> dict:
    context = history_context(reference_date, previous)
    limits = dict(limits_checked(DEFAULT_LIMITS if limits is None else limits))
    if not isinstance(seed, str) or not seed:
        raise ValueError('missing seed')
    eligible = base.eligible(context['qids'])
    payload = dict(schema_version=SCHEMA, reference_date=reference_date, seed=seed,
                   base_id=base.identity, previous=context, limits=limits, status='omitted',
                   attempts=0, rejections={}, eligible_group_count=len(eligible),
                   connected_group_count=connected_count(eligible), puzzle=None)
    rng = random.Random(digest(payload))
    rejected = Counter()
    for attempt in range(1, limits['attempts'] + 1):
        payload['attempts'] = attempt
        try:
            if len(eligible) < 3:
                raise ValueError('insufficient eligible groups')
            entries = place(eligible, rng, rng.randint(3, min(5, len(eligible))), limits['placement_nodes'])
        except BudgetExhausted:
            rejected['budget'] += 1
            continue
        except ValueError:
            rejected['placement'] += 1
            continue
        for e in entries:
            g = eligible[e['qid']]
            sources = copy.deepcopy(rng.choice(base.clues(e['qid'])))
            e.update(canonical_name=g['canonical_name'], aliases=list(g['aliases']), sources=sources,
                     matching_qids=base.matching(sources), clue=clue_text(sources))
        try:
            board = canonical_board(entries)
            board['audited_group_count'] = len(base.groups)
            board['proof'] = count_assignments(board['entries'], domains_for(board['entries'], base),
                                                limits['proof_nodes'])
            validate_board(board, reference_date, base, limits['proof_nodes'])
        except BudgetExhausted:
            rejected['budget'] += 1
            continue
        except ValueError:
            rejected['validation'] += 1
            continue
        payload.update(status='ready', puzzle=board)
        break
    payload['rejections'] = dict(sorted(rejected.items()))
    payload['dataset_version'] = digest(payload)
    validate(payload, base)
    return payload
