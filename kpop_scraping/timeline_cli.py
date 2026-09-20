"""Command-line interface for deterministic timeline ("Quando foi?") puzzle generation."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .timeline_generator import generate_timeline_puzzle
from .timeline_schema import write_timeline_puzzle_atomic


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deterministic K-pop timeline puzzle JSON ('Quando foi?')"
    )
    parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output JSON file path (stdout if omitted)",
    )
    parser.add_argument(
        "--seed",
        type=str,
        help="Random seed for deterministic puzzle selection",
    )
    parser.add_argument(
        "--date",
        type=date.fromisoformat,
        help="Calendar date YYYY-MM-DD for daily puzzle",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database.is_file():
        sys.stderr.write(f"Database does not exist: {args.database}\n")
        return 1

    reference_date = args.date or datetime.now(timezone.utc).date()
    connection = sqlite3.connect(
        f"{args.database.resolve().as_uri()}?mode=ro",
        uri=True,
    )
    connection.row_factory = sqlite3.Row

    try:
        puzzle = generate_timeline_puzzle(
            connection,
            reference_date=reference_date,
            seed=args.seed,
        )
    finally:
        connection.close()

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_timeline_puzzle_atomic(args.output, puzzle)
        sys.stdout.write(f"Wrote timeline puzzle to {args.output}\n")
    else:
        sys.stdout.write(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
