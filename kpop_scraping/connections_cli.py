"""Command-line interface for deterministic connections puzzle generation."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .connections_generator import generate_connections_puzzle
from .connections_schema import write_connections_puzzle_atomic


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate deterministic K-pop connections puzzle JSON"
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
        help="Calendar date YYYY-MM-DD for daily connections puzzle",
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
        default_seed = f"kpop-connections-daily-{args.date.isoformat()}"
    else:
        reference_date = datetime.now(timezone.utc).date()
        default_seed = f"kpop-connections-{reference_date.isoformat()}"

    seed = args.seed if args.seed is not None else default_seed

    try:
        connection = sqlite3.connect(
            f"{args.database.resolve().as_uri()}?mode=ro", uri=True
        )
    except sqlite3.Error:
        connection = sqlite3.connect(str(args.database))

    connection.row_factory = sqlite3.Row
    try:
        puzzle = generate_connections_puzzle(
            connection, seed=seed, reference_date=reference_date
        )
    except (sqlite3.Error, ValueError) as exc:
        sys.stderr.write(f"Connections puzzle generation failed: {type(exc).__name__}: {exc}\n")
        return 1
    finally:
        connection.close()

    if args.output is not None:
        output_path = args.output
        try:
            write_connections_puzzle_atomic(output_path, puzzle)
        except (OSError, ValueError) as exc:
            sys.stderr.write(f"Failed to write connections puzzle output: {exc}\n")
            return 1
        print(f"Connections puzzle written to {output_path} (puzzle_id: {puzzle['puzzle_id'][:12]}...)")
    else:
        sys.stdout.write(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
