"""Command-line interface for deterministic Strands puzzle generation."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .quiz_repository import _load_entities, _load_facts
from .strands_generator import (
    DEFAULT_TIME_LIMIT_SECONDS,
    STRANDS_DEFAULT_COLS,
    STRANDS_DEFAULT_ROWS,
    build_strands_themes,
    describe_themes,
    generate_strands_puzzle,
    verify_strands_uniqueness,
)
from .strands_schema import (
    STRANDS_MAX_SIDE,
    STRANDS_MIN_SIDE,
    validate_strands_puzzle,
    write_strands_puzzle_atomic,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a deterministic K-pop Strands puzzle JSON"
    )
    parser.add_argument("--database", type=Path, required=True, help="Path to SQLite database")
    parser.add_argument(
        "--output", type=Path, help="Output JSON file path (stdout if omitted)"
    )
    parser.add_argument(
        "--seed",
        type=str,
        help="Random seed (default: kpop-strands-daily-<date>)",
    )
    parser.add_argument(
        "--date",
        type=date.fromisoformat,
        help="Calendar date YYYY-MM-DD for the daily Strands puzzle",
    )
    parser.add_argument("--theme", type=str, help="Restrict generation to matching themes")
    parser.add_argument(
        "--rows",
        type=int,
        default=STRANDS_DEFAULT_ROWS,
        help=f"Grid rows (default: {STRANDS_DEFAULT_ROWS}, range: "
        f"{STRANDS_MIN_SIDE} to {STRANDS_MAX_SIDE})",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=STRANDS_DEFAULT_COLS,
        help=f"Grid columns (default: {STRANDS_DEFAULT_COLS}, range: "
        f"{STRANDS_MIN_SIDE} to {STRANDS_MAX_SIDE})",
    )
    parser.add_argument(
        "--time-limit",
        type=float,
        default=DEFAULT_TIME_LIMIT_SECONDS,
        help=f"Wall-clock limit in seconds (default: {DEFAULT_TIME_LIMIT_SECONDS:g})",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Validate the schema and re-prove solution uniqueness before writing",
    )
    parser.add_argument(
        "--list-themes",
        action="store_true",
        help="Print each theme's words, discarded names and grid feasibility, then exit",
    )
    return parser


def _connect(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database.is_file():
        sys.stderr.write(f"Database does not exist: {args.database}\n")
        return 1

    reference_date = args.date or datetime.now(timezone.utc).date()
    seed = args.seed if args.seed is not None else f"kpop-strands-daily-{reference_date.isoformat()}"

    connection = _connect(args.database)
    try:
        if args.list_themes:
            entities = _load_entities(connection)
            facts, _rejected = _load_facts(connection, entities)
            report = describe_themes(
                build_strands_themes(entities, facts),
                [(9, 9), (9, 10), (10, 10)],
            )
            sys.stdout.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
            return 0
        puzzle = generate_strands_puzzle(
            connection,
            seed=seed,
            reference_date=reference_date,
            theme_filter=args.theme,
            rows=args.rows,
            cols=args.cols,
            time_limit_seconds=args.time_limit,
        )
    except (sqlite3.Error, ValueError) as exc:
        sys.stderr.write(f"Strands puzzle generation failed: {type(exc).__name__}: {exc}\n")
        return 1
    finally:
        connection.close()

    if args.verify:
        try:
            validate_strands_puzzle(puzzle)
            verify_strands_uniqueness(puzzle)
        except ValueError as exc:
            sys.stderr.write(f"Strands puzzle verification failed: {exc}\n")
            return 1

    if args.output is not None:
        try:
            write_strands_puzzle_atomic(args.output, puzzle)
        except (OSError, ValueError) as exc:
            sys.stderr.write(f"Failed to write Strands puzzle output: {exc}\n")
            return 1
        sys.stdout.write(
            f"Strands puzzle written to {args.output} (puzzle_id: {puzzle['puzzle_id'][:12]}...)\n"
        )
    else:
        sys.stdout.write(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
