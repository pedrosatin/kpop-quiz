"""Command-line interface for deterministic name guess puzzle generation."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .name_guess_generator import generate_name_guess_puzzle
from .name_guess_schema import write_name_guess_puzzle_atomic


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deterministic K-pop name guess puzzle JSON"
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
    parser.add_argument(
        "--word-length",
        type=int,
        help="Filter target entities to a specific word length",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=6,
        help="Maximum allowed guess attempts (default: 6)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database.is_file():
        sys.stderr.write(f"Database does not exist: {args.database}\n")
        return 1

    if args.date is not None:
        reference_date = args.date
        default_seed = f"kpop-guess-daily-{args.date.isoformat()}"
    else:
        reference_date = datetime.now(timezone.utc).date()
        default_seed = f"kpop-guess-{reference_date.isoformat()}"

    seed = args.seed if args.seed is not None else default_seed

    try:
        connection = sqlite3.connect(
            f"{args.database.resolve().as_uri()}?mode=ro", uri=True
        )
    except sqlite3.Error:
        connection = sqlite3.connect(str(args.database))

    connection.row_factory = sqlite3.Row
    try:
        puzzle = generate_name_guess_puzzle(
            connection,
            seed=seed,
            reference_date=reference_date,
            word_length=args.word_length,
            max_attempts=args.max_attempts,
        )
    except (sqlite3.Error, ValueError) as exc:
        sys.stderr.write(f"Name guess puzzle generation failed: {type(exc).__name__}: {exc}\n")
        return 1
    finally:
        connection.close()

    if args.output is not None:
        try:
            write_name_guess_puzzle_atomic(args.output, puzzle)
            sys.stdout.write(
                f"Name guess puzzle written to {args.output} (puzzle_id: {puzzle['puzzle_id'][:12]}...)\n"
            )
        except (OSError, ValueError) as exc:
            sys.stderr.write(f"Failed to write output file: {exc}\n")
            return 1
    else:
        sys.stdout.write(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
