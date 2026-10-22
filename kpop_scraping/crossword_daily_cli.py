"""Generate, verify or benchmark daily crosswords without collection or publication."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from collections import Counter
from datetime import timedelta
from pathlib import Path

from .crossword_daily import (DEFAULT_LIMITS, generate, next_context, valid_date, validate)
from .crossword_daily_repository import load_base
from .quiz_schema import write_json_atomic


def protected_output(output, inputs):
    for source in inputs:
        if source and (output.resolve() == source.resolve() or
                       (output.exists() and source.exists() and output.samefile(source))):
            raise ValueError('output must not overwrite an input')


def file_hash(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def benchmark(base, start, days, seed, previous, limits, output_dir):
    if not 1 <= days <= 366:
        raise ValueError('benchmark requires 1..366 sequential dates')
    if '.scratch' not in output_dir.resolve().parts:
        raise ValueError('benchmark operational output must be under .scratch')
    records, rejections, used, started = [], Counter(), set(), time.perf_counter()
    for offset in range(days):
        day = (valid_date(start) + timedelta(days=offset)).isoformat()
        tick = time.perf_counter()
        artifact = generate(base, day, seed, previous, limits)
        validate(artifact, base)
        qids = set(artifact['puzzle']['vocabulary']) if artifact['puzzle'] else set()
        if used & qids:
            raise ValueError('consecutive-day overlap')
        write_json_atomic(output_dir / f'{day}.json', artifact, lambda p: validate(p, base))
        records.append(dict(date=day, status=artifact['status'], attempts=artifact['attempts'],
                            rejections=artifact['rejections'], qids=sorted(qids),
                            eligible_groups=artifact['eligible_group_count'],
                            connected_groups=artifact['connected_group_count'],
                            proof=artifact['puzzle']['proof'] if artifact['puzzle'] else None,
                            seconds=time.perf_counter() - tick))
        rejections.update(artifact['rejections'])
        previous = next_context(artifact, base)
        used = qids
    attempts = sum(r['attempts'] for r in records)
    failures = sum(r['status'] == 'omitted' for r in records)
    return dict(start=start, end=records[-1]['date'], days=days, seed=seed,
                base_id=base.identity, universe_groups=len(base.groups), limits=limits,
                failures=failures, failure_rate=failures / days, attempts=attempts,
                rejected_attempts=sum(rejections.values()), rejections=dict(rejections),
                rejection_rate=sum(rejections.values()) / attempts,
                min_connected_groups=min(r['connected_groups'] for r in records),
                consecutive_intersections_empty=True, seconds=time.perf_counter() - started,
                records=records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--reference-date')
    parser.add_argument('--seed', default='crossword-daily')
    history = parser.add_mutually_exclusive_group()
    history.add_argument('--previous-artifact', type=Path)
    history.add_argument('--previous-context', type=Path)
    history.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--attempts', type=int, default=DEFAULT_LIMITS['attempts'])
    parser.add_argument('--placement-nodes', type=int, default=DEFAULT_LIMITS['placement_nodes'])
    parser.add_argument('--proof-nodes', type=int, default=DEFAULT_LIMITS['proof_nodes'])
    parser.add_argument('--benchmark-days', type=int)
    parser.add_argument('--benchmark-dir', type=Path)
    args = parser.parse_args()
    try:
        if not args.database.is_absolute():
            raise ValueError('database path must be absolute')
        base = load_base(args.database)
        if args.verify:
            validate(json.loads(args.verify.read_text()), base)
            print('daily crossword valid; factual matching and proof recomputed')
            return 0
        if not args.reference_date:
            raise ValueError('--reference-date required')
        if args.previous_artifact:
            previous = next_context(json.loads(args.previous_artifact.read_text()), base)
        elif args.previous_context:
            previous = json.loads(args.previous_context.read_text())
        elif args.bootstrap:
            previous = dict(state='bootstrap', date=args.reference_date, qids=[])
        else:
            raise ValueError('explicit previous-day context or bootstrap required')
        limits = dict(attempts=args.attempts, placement_nodes=args.placement_nodes, proof_nodes=args.proof_nodes)
        inputs = [args.database, args.previous_artifact, args.previous_context]
        if args.benchmark_days is not None:
            if not args.benchmark_dir:
                raise ValueError('--benchmark-dir required')
            # Protect every planned output before any write.
            outputs = [args.benchmark_dir / 'benchmark.json'] + [args.benchmark_dir /
                       f'{(valid_date(args.reference_date) + timedelta(days=i)).isoformat()}.json'
                       for i in range(max(0, min(args.benchmark_days, 366)))]
            for output in outputs:
                protected_output(output, inputs)
            before = file_hash(args.database)
            report = benchmark(base, args.reference_date, args.benchmark_days, args.seed, previous,
                               limits, args.benchmark_dir)
            report.update(database_sha256_before=before, database_sha256_after=file_hash(args.database))
            if report['database_sha256_before'] != report['database_sha256_after']:
                raise ValueError('database changed during benchmark')
            write_json_atomic(args.benchmark_dir / 'benchmark.json', report, lambda p: None)
            print(json.dumps({k: v for k, v in report.items() if k != 'records'}, sort_keys=True))
            return 0
        if not args.output:
            raise ValueError('--output required')
        protected_output(args.output, inputs)
        artifact = generate(base, args.reference_date, args.seed, previous, limits)
        write_json_atomic(args.output, artifact, lambda p: validate(p, base))
        print(f"{artifact['status']}: {artifact['attempts']} attempts; {artifact['connected_group_count']} connected groups")
        return 0  # Explicit omission is a valid daily outcome, distinct from invalid input.
    except (ValueError, TypeError, KeyError, AttributeError, IndexError, OSError, sqlite3.Error) as exc:
        print(f'daily crossword rejected: {exc}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
