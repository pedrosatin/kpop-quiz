"""Command-line interface for deterministic word search puzzle generation."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .word_search_generator import generate_word_search_puzzle
from .word_search_schema import (
    validate_word_search_puzzle,
    write_word_search_puzzle_atomic,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deterministic K-pop word search puzzle JSON"
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
        help="Calendar date YYYY-MM-DD for daily word search puzzle",
    )
    parser.add_argument(
        "--theme",
        type=str,
        help="Filter puzzle to a specific factual theme",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=12,
        help="Number of grid rows (default: 12, range: 8 to 16)",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=12,
        help="Number of grid columns (default: 12, range: 8 to 16)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify generated puzzle against schema specification",
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
        default_seed = f"kpop-word-search-daily-{args.date.isoformat()}"
    else:
        reference_date = datetime.now(timezone.utc).date()
        default_seed = f"kpop-word-search-{reference_date.isoformat()}"

    seed = args.seed if args.seed is not None else default_seed

    try:
        connection = sqlite3.connect(
            f"{args.database.resolve().as_uri()}?mode=ro", uri=True
        )
    except sqlite3.Error:
        connection = sqlite3.connect(str(args.database))

    connection.row_factory = sqlite3.Row
    try:
        puzzle = generate_word_search_puzzle(
            connection,
            seed=seed,
            reference_date=reference_date,
            theme_filter=args.theme,
            rows=args.rows,
            cols=args.cols,
        )
    except (sqlite3.Error, ValueError) as exc:
        sys.stderr.write(f"Word search puzzle generation failed: {type(exc).__name__}: {exc}\n")
        return 1
    finally:
        connection.close()

    if args.verify:
        try:
            validate_word_search_puzzle(puzzle)
        except ValueError as exc:
            sys.stderr.write(f"Word search puzzle verification failed: {exc}\n")
            return 1

    if args.output is not None:
        try:
            write_word_search_puzzle_atomic(args.output, puzzle)
            sys.stdout.write(
                f"Word search puzzle written to {args.output} (puzzle_id: {puzzle['puzzle_id'][:12]}...)\n"
            )
        except (OSError, ValueError) as exc:
            sys.stderr.write(f"Failed to write word search puzzle output: {exc}\n")
            return 1
    else:
        sys.stdout.write(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
