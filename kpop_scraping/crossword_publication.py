"""Durable, dated record of what each day published as its crossword.

The daily crossword cannot repeat a group on consecutive days, and the fact
base changes between runs, so the previous artifact alone cannot prove what
was played: ``crossword_daily.validate`` needs the same base. Each published
set therefore carries ``crossword-publication.<date>.json`` with the state of
the day, the QIDs it published, the artifact checksum and base identity, and
the history the generator consumed. The records accumulate in the main data
directory (like ``grid-publication.<date>.json``), and the next day is
generated from the confirmed record of the day before.

A missing record is never read as an empty day: the dependent day omits its
crossword instead. The only derived record is ``source: pilot``, for a set
published before the daily integration, when the site still served the fixed
audited board of ``crossword-pilot.json`` every day.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from . import crossword_cli as pilot
from .crossword_daily import history_context
from .quiz_schema import write_json_atomic

VERSION = 'kpop-crossword-publication-v1'
FIELDS = {'schema_version', 'reference_date', 'source', 'state', 'qids', 'dataset_version',
          'base_id', 'previous', 'reason'}
PREFIX = 'crossword-publication.'
PILOT_FILENAME = 'crossword-pilot.json'
_HASH = re.compile(r'[0-9a-f]{64}')
_QID = re.compile(r'Q[1-9][0-9]*')


def filename(reference_date: str) -> str:
    if not isinstance(reference_date, str) or date.fromisoformat(reference_date).isoformat() != reference_date:
        raise ValueError('Invalid crossword publication date')
    return f'{PREFIX}{reference_date}.json'


def _hash_or_none(value: Any) -> bool:
    return value is None or (isinstance(value, str) and bool(_HASH.fullmatch(value)))


def validate_record(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != FIELDS or value['schema_version'] != VERSION:
        raise ValueError('Invalid crossword publication version or fields')
    day = value['reference_date']
    filename(day)
    qids, state, source = value['qids'], value['state'], value['source']
    if (not isinstance(qids, list) or any(not isinstance(q, str) or not _QID.fullmatch(q) for q in qids)
            or qids != sorted(set(qids))):
        raise ValueError('Invalid crossword publication QIDs')
    if state not in ('played', 'omitted') or source not in ('daily', 'pilot'):
        raise ValueError('Invalid crossword publication state')
    if (state == 'played') != (3 <= len(qids) <= 5) or (state == 'omitted' and qids):
        raise ValueError('Crossword publication state and QIDs disagree')
    if not _hash_or_none(value['dataset_version']) or not _hash_or_none(value['base_id']):
        raise ValueError('Invalid crossword publication hash')
    if value['previous'] is not None and history_context(day, value['previous']) != value['previous']:
        raise ValueError('Invalid crossword publication history')
    reason = value['reason']
    if reason is not None and (not isinstance(reason, str) or not reason):
        raise ValueError('Invalid crossword publication reason')
    if source == 'pilot':
        if (state != 'played' or value['dataset_version'] is None or value['base_id'] is not None
                or value['previous'] is not None or reason is not None):
            raise ValueError('Invalid pilot crossword publication')
    elif state == 'played':
        if (value['dataset_version'] is None or value['base_id'] is None or value['previous'] is None
                or reason is not None):
            raise ValueError('Invalid played crossword publication')
        if set(qids) & set(value['previous']['qids']):
            raise ValueError('Crossword repeats a group of the previous day')
    elif (value['dataset_version'] is None) != (value['previous'] is None) or reason is None:
        # An omitted artifact records its history; an omission without one says why.
        raise ValueError('Invalid omitted crossword publication')


def _record(**fields: Any) -> dict:
    value = dict(schema_version=VERSION, source='daily', qids=[], dataset_version=None,
                 base_id=None, previous=None, reason=None)
    value.update(fields)
    validate_record(value)
    return value


def record_from_artifact(artifact: dict) -> dict:
    """Record of a ``crossword-daily-v1`` artifact, ready or omitted."""
    ready = artifact['status'] == 'ready'
    return _record(reference_date=artifact['reference_date'],
                   state='played' if ready else 'omitted',
                   qids=list(artifact['puzzle']['vocabulary']) if ready else [],
                   dataset_version=artifact['dataset_version'], base_id=artifact['base_id'],
                   previous=artifact['previous'],
                   reason=None if ready else 'generation attempts exhausted')


def omission_record(reference_date: str, reason: str) -> dict:
    """A day published without any crossword artifact."""
    return _record(reference_date=reference_date, state='omitted', reason=reason)


def pilot_record(reference_date: str, board: dict) -> dict:
    """The fixed audited board a set published before the daily integration served."""
    pilot.validate(board)
    return _record(reference_date=reference_date, source='pilot', state='played',
                   qids=list(board['vocabulary']), dataset_version=board['dataset_version'])


def read_record(directory: Path, reference_date: str) -> dict | None:
    path = Path(directory) / filename(reference_date)
    if not path.exists():
        return None
    value = json.loads(path.read_text(encoding='utf-8'))
    validate_record(value)
    if value['reference_date'] != reference_date:
        raise ValueError('Crossword publication date mismatch')
    return value


def write_record(directory: Path, value: dict) -> None:
    write_json_atomic(Path(directory) / filename(value['reference_date']), value, validate_record)


def has_history(directory: Path) -> bool:
    return any(Path(directory).glob(f'{PREFIX}*.json'))


def read_pilot(directory: Path) -> dict | None:
    """The audited pilot board in directory, when present and valid."""
    path = Path(directory) / PILOT_FILENAME
    if not path.is_file():
        return None
    try:
        board = json.loads(path.read_text(encoding='utf-8'))
        pilot.validate(board)
    except (OSError, ValueError):
        return None
    return board


def confirmed_record(directory: Path, reference_date: str) -> dict | None:
    """Record of reference_date in directory.

    Before the first daily record exists, every day served the audited pilot
    board, so a valid ``crossword-pilot.json`` stands for those days. Once any
    record exists, a missing one stays missing.
    """
    record = read_record(directory, reference_date)
    if record is not None or has_history(directory):
        return record
    board = read_pilot(directory)
    return pilot_record(reference_date, board) if board is not None else None


def context_for(reference_date: str, previous_record: dict | None) -> dict | None:
    """History context to generate reference_date from the record of the day before."""
    if previous_record is None:
        return None
    expected = (date.fromisoformat(reference_date) - timedelta(days=1)).isoformat()
    if previous_record['reference_date'] != expected:
        raise ValueError('Crossword publication is not the previous day')
    return history_context(reference_date, {
        'state': previous_record['state'], 'date': expected, 'qids': list(previous_record['qids'])})


def verify_history(*directories: Path) -> None:
    """Validate every record and that no two consecutive played days share a group.

    Records of the first directory win over later ones for the same date, so
    the main directory, where promoted days are confirmed, goes first.
    """
    records: dict[str, dict] = {}
    for directory in directories:
        for path in sorted(Path(directory).glob(f'{PREFIX}*.json')):
            day = path.name.removeprefix(PREFIX).removesuffix('.json')
            record = read_record(directory, day)
            records.setdefault(day, record)
    for day, record in records.items():
        previous = records.get((date.fromisoformat(day) - timedelta(days=1)).isoformat())
        if (previous is not None and record['state'] == 'played' and previous['state'] == 'played'
                and set(record['qids']) & set(previous['qids'])):
            raise ValueError(f'Crossword of {day} repeats a group of the previous day')
