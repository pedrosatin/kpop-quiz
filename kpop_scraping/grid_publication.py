"""Versioned publication authority for a day's grid, separate from grid-v1."""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any

from .quiz_schema import write_json_atomic

VERSION = 'kpop-grid-publication-v1'
FIELDS = {'schema_version', 'reference_date', 'grid_id', 'grid_reference_date', 'replaces'}


def filename(reference_date: str) -> str:
    if not isinstance(reference_date, str) or date.fromisoformat(reference_date).isoformat() != reference_date:
        raise ValueError('Invalid grid publication date')
    return f'grid-publication.{reference_date}.json'


def validate_publication(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != FIELDS or value['schema_version'] != VERSION:
        raise ValueError('Invalid grid publication version or fields')
    filename(value['reference_date'])
    ids = value['replaces']
    if not isinstance(ids, list) or len(ids) != len(set(str(i) for i in ids)):
        raise ValueError('Invalid replaced grid identities')
    for identity in ids + ([value['grid_id']] if value['grid_id'] is not None else []):
        if not isinstance(identity, str) or not re.fullmatch(r'[0-9a-f]{64}', identity):
            raise ValueError('Invalid grid publication hash')
    if value['grid_id'] in ids:
        raise ValueError('Replacement cannot reuse a rejected identity')
    grid_date = value['grid_reference_date']
    if value['grid_id'] is None:
        if grid_date is not None:
            raise ValueError('Absent grid cannot have a date')
    else:
        filename(grid_date)
        if grid_date > value['reference_date'] or (ids and grid_date != value['reference_date']):
            raise ValueError('Invalid replacement grid date')


def read_publication(directory: Path, reference_date: str) -> dict | None:
    path = directory / filename(reference_date)
    if not path.exists():
        return None
    value = json.loads(path.read_text(encoding='utf-8'))
    validate_publication(value)
    if value['reference_date'] != reference_date:
        raise ValueError('Grid publication date mismatch')
    return value


def publication(reference_date: str, grid: dict | None, previous: dict | None = None,
                rejected_id: str | None = None) -> dict:
    ids = set(previous['replaces'] if previous else [])
    if rejected_id is not None:
        ids.add(rejected_id)
    value = dict(schema_version=VERSION, reference_date=reference_date,
                 grid_id=grid['grid_id'] if grid else None,
                 grid_reference_date=grid['reference_date'] if grid else None,
                 replaces=sorted(ids))
    validate_publication(value)
    return value


def write_publication(directory: Path, value: dict) -> None:
    write_json_atomic(directory / filename(value['reference_date']), value, validate_publication)
