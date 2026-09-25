"""Command-line interface for unified daily K-pop puzzle generation and publication."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .daily_puzzles_runner import run_daily_puzzles


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Unified runner for deterministic daily K-pop puzzle generation"
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Calendar date YYYY-MM-DD for daily puzzles (default: today in Brasilia/UTC timezone)",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("data/kpop.db"),
        help="Path to SQLite database (default: data/kpop.db)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("web/public/data"),
        help="Output directory for generated puzzle artifacts (default: web/public/data)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate and validate artifacts in temporary storage without modifying output directory",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify all published daily puzzle artifacts in output directory against schemas",
    )
    parser.add_argument(
        "--timer-seconds",
        type=int,
        help="Optional question timer limit in seconds for quiz sessions",
    )
    return parser


def report_reused_grid(grid_reused: dict[str, str] | None) -> None:
    """Make a kept grid visible; GitHub Actions shows ::warning:: lines in the run summary."""
    if not grid_reused:
        return
    message = (
        f"Grid kept from {grid_reused['reference_date']} because generation failed: "
        f"{grid_reused['error']}"
    )
    sys.stderr.write(f"WARNING: {message}\n")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::warning title=Daily grid not updated::{message}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.verify:
            run_daily_puzzles(
                output_dir=args.output_dir,
                verify_only=True,
            )
            print(f"Daily puzzle artifacts verified successfully in {args.output_dir}")
            return 0

        if not args.database.is_file():
            sys.stderr.write(f"Database does not exist: {args.database}\n")
            return 1

        result = run_daily_puzzles(
            database=args.database,
            output_dir=args.output_dir,
            reference_date=args.date,
            dry_run=args.dry_run,
            timer_seconds=args.timer_seconds,
        )
        report_reused_grid(result.get("grid_reused"))
        mode_str = "[dry-run] " if result.get("dry_run") else ""
        print(
            f"{mode_str}Daily puzzles for {result['reference_date']} generated and verified successfully in {result['output_dir']}"
        )
        return 0
    except Exception as exc:
        sys.stderr.write(f"Daily puzzles generation failed: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
