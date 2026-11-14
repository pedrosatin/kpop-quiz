"""Command-line interface for unified daily K-pop puzzle generation and publication."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .daily_puzzles_runner import run_daily_puzzles
from .daily_set import single_line
from .quiz_clue_coverage import MANIFEST_FILENAME, published_clue_coverage_lines


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
        "--ahead",
        action="store_true",
        help="Also publish the next day's puzzles under <output-dir>/next/",
    )
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Generate the day again even if it is already published or waiting in next/",
    )
    parser.add_argument(
        "--related-clues",
        action="store_true",
        help=(
            "Also publish manifest-v3.json, whose sessions carry the decade clues that "
            "cite the answer's own dated fact. manifest-v2.json keeps the sessions without "
            "them, which is all a client released before they existed ever reads"
        ),
    )
    parser.add_argument(
        "--catalog",
        action="store_true",
        help=(
            "Also publish the static question catalog (catalog-manifest-v1.json and its "
            "shards) built from this run's dataset. Without it a catalog left by an earlier "
            "run is withdrawn. No released client reads the catalog yet"
        ),
    )
    parser.add_argument(
        "--board-swaps-file",
        type=Path,
        help=(
            "Write whether this run was asked to --regenerate and the board swaps the runner "
            "declared, for the board swap gate that follows the run in the cron"
        ),
    )
    parser.add_argument(
        "--timer-seconds",
        type=int,
        help="Optional question timer limit in seconds for quiz sessions",
    )
    return parser


def warn(title: str, message: str) -> None:
    """Write a warning to stderr and, in GitHub Actions, to the run summary.

    The message may quote Wikipedia or Wikidata text through an exception.
    The workflow command format escapes ``%``, CR and LF, so the message
    stays one annotation and cannot start a command of its own on a new
    line. The stderr copy gets the same escaping, because the runner reads
    commands from both streams.
    """
    escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    sys.stderr.write(f"WARNING: {escaped}\n")
    sys.stderr.flush()
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::warning title={title}::{escaped}", flush=True)


def report_reused_grid(grid_reused: dict[str, str] | None) -> None:
    """Make a kept grid visible; GitHub Actions shows ::warning:: lines in the run summary."""
    if not grid_reused:
        return
    message = (
        f"Grid kept from {grid_reused['reference_date']} because generation failed: "
        f"{grid_reused['error']}"
    )
    warn("Daily grid not updated", message)


def report_revalidated_grid(grid_revalidated: dict[str, Any] | None) -> None:
    """Make a published grid replaced or dropped by the current eligibility policy visible."""
    if not grid_revalidated:
        return
    outcome = (
        f"replaced by grid {grid_revalidated['grid_id']}"
        if grid_revalidated["action"] == "regenerated"
        else f"removed because a new one could not be generated: {grid_revalidated['error']}"
    )
    message = (
        f"Published grid {grid_revalidated['previous_grid_id']} no longer meets the "
        f"eligibility policy ({grid_revalidated['reason']}); {outcome}"
    )
    warn("Daily grid revalidated", message)


def report_skipped_grid(grid_skipped: dict[str, Any] | None) -> None:
    """Make a day published without a grid visible in the run summary."""
    if not grid_skipped:
        return
    if grid_skipped.get("published_without_grid"):
        # A kept or promoted set records the absent artifact only; the
        # original generation error belongs to the day that first skipped it.
        message = "The published set for this day carries no grid.daily.json"
    else:
        previous = (
            f"previous grid rejected: {grid_skipped['previous_invalid']}"
            if grid_skipped.get("previous_invalid")
            else "no previous grid available"
        )
        message = (
            f"Day published without a grid because generation failed: "
            f"{grid_skipped['error']} ({previous})"
        )
    warn("Daily grid missing", message)


def report_skipped_code_groups(code_groups_skipped: dict[str, Any] | None) -> None:
    """Make a day published without the group code pilot visible in the run summary."""
    if not code_groups_skipped:
        return
    if code_groups_skipped.get("published_without_code_groups"):
        # A kept or promoted set records the absent artifact only; the
        # original generation error belongs to the day that first skipped it.
        message = "The published set for this day carries no code-groups.daily.json"
    else:
        message = (
            "Day published without the group code pilot because generation "
            f"failed: {code_groups_skipped['error']}"
        )
    warn("Daily group code missing", message)


# Result key, warning title and published file of each game reported by
# report_skipped_games; the grid, the group code pilot and the crossword have
# reporters of their own.
SKIPPED_GAMES = (
    ("quiz_skipped", "Daily quiz missing", "the quiz (manifest-v2.json)"),
    ("connections_skipped", "Daily connections missing", "connections.daily.json"),
    ("name_guess_skipped", "Daily name guess missing", "name-guess.daily.json"),
    ("word_search_skipped", "Daily word search missing", "word-search.daily.json"),
    ("timeline_skipped", "Daily timeline missing", "timeline.daily.json"),
)


def report_skipped_games(result: dict[str, Any]) -> None:
    """Make each game a day was published without visible in the run summary."""
    for key, title, artifact in SKIPPED_GAMES:
        skipped = result.get(key)
        if not skipped:
            continue
        if skipped.get("published_without"):
            # A kept or promoted set: the reason, when the set recorded one,
            # belongs to the day that first left the game out.
            reason = f" ({skipped['error']})" if skipped.get("error") else ""
            message = f"The published set for {result['reference_date']} carries no {artifact}{reason}"
        else:
            message = (
                f"Day {result['reference_date']} published without {artifact} because "
                f"generation failed: {skipped['error']}"
            )
        warn(title, message)


def report_ambiguous_connections(result: dict[str, Any]) -> None:
    """Make a kept or promoted connections board with a second solution visible.

    The board stays published (see ``_check_connections_partition``). The
    message names only the board id and the date, both from the verified set.
    """
    partition = result.get("connections_partition")
    if not partition or partition["reason"] != "ambiguous":
        return
    warn(
        "Daily connections ambiguous",
        f"Connections board {result['connections_id']} of {result['reference_date']} admits "
        "a second solution under the current database; the board already served is kept "
        "(--regenerate publishes a new one)",
    )


def report_skipped_next_day(next_skipped: dict[str, Any] | None) -> None:
    """Make a next day that could not be published ahead visible."""
    if not next_skipped:
        return
    warn(
        "Next day not published ahead",
        f"No set for {next_skipped['reference_date']} under next/: {next_skipped['error']}",
    )


def report_skipped_crossword(
    crossword_skipped: dict[str, Any] | None, crossword_confirmed: dict[str, Any] | None = None
) -> None:
    """Make a day without a crossword board, or one replaced on promotion, visible."""
    if crossword_confirmed and crossword_confirmed["action"] != "recorded":
        message = (
            f"Crossword {crossword_confirmed['previous_dataset_version']} was prepared from a "
            f"history the confirmed previous day no longer matches; {crossword_confirmed['action']}"
        )
        warn("Daily crossword replaced", message)
    if not crossword_skipped:
        return
    message = f"Day published without a crossword board ({crossword_skipped['reason']})"
    warn("Daily crossword omitted", message)


def report_word_search_fallback(fallback: dict[str, Any] | None) -> None:
    """Make a word search published with a theme other than the drawn one visible."""
    if not fallback:
        return
    message = (
        f"Word search theme {fallback['requested_theme_id']} could not be placed; "
        f"published {fallback['used_theme_id']} instead "
        f"(tried and abandoned: {', '.join(fallback['failed_theme_ids'])})"
    )
    warn("Word search theme replaced", message)


def report_evidence_rules(evidence_rules: dict[str, str | None] | None) -> None:
    """Print which evidence rules decided the facts, and warn when the code has others.

    A cron run that restored the cached database publishes facts decided by
    the rules of an earlier run, which a newer release may have changed.
    """
    if not evidence_rules:
        return
    code, database = evidence_rules["code"], evidence_rules["database"]
    print(f"Evidence rules: database {database or 'not recorded'}, code {code}")
    if database == code:
        return
    decided_by = (
        f"Facts in the database were decided by evidence rules {database}"
        if database
        else "The last completed fact run in the database recorded no evidence rules version"
    )
    message = f"{decided_by}; the code has {code}"
    warn("Evidence rules differ", message)


def report_clue_coverage(output_dir: str | Path, prefix: str = "") -> None:
    """Print how many published quiz questions carry a clue.

    A dry run leaves nothing on disk, so a missing manifest prints nothing.
    The artifacts were verified before this runs, so a read failure here only
    costs the report and is surfaced as a warning.
    """
    directory = Path(output_dir)
    if not (directory / MANIFEST_FILENAME).is_file():
        return
    try:
        lines = published_clue_coverage_lines(directory, f"{prefix}Quiz clues in {directory}")
    except (OSError, ValueError, KeyError) as exc:
        sys.stderr.write(f"WARNING: Quiz clue coverage not reported for {directory}: {exc}\n")
        return
    for line in lines:
        print(line)


def report_catalog(
    catalog: dict[str, Any] | None, prefix: str = "", skipped: dict[str, Any] | None = None
) -> None:
    """Print what the question catalog offers, or that it was withdrawn."""
    if skipped:
        warn("Quiz catalog withdrawn", f"The question catalog could not be built: {skipped['error']}")
    if not catalog:
        return
    if catalog.get("withdrawn"):
        print(f"{prefix}Quiz catalog withdrawn: this run was not asked to publish one")
        return
    for line in catalog["lines"]:
        print(f"{prefix}{line}")


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
            ahead=args.ahead,
            regenerate=args.regenerate,
            related_clues=args.related_clues,
            catalog=args.catalog,
        )
        if args.board_swaps_file:
            args.board_swaps_file.write_text(
                json.dumps({"regenerate": args.regenerate, "swaps": result["board_swaps"]}),
                encoding="utf-8",
            )
        report_reused_grid(result.get("grid_reused"))
        report_revalidated_grid(result.get("grid_revalidated"))
        report_skipped_grid(result.get("grid_skipped"))
        report_skipped_code_groups(result.get("code_groups_skipped"))
        report_skipped_games(result)
        report_ambiguous_connections(result)
        report_skipped_crossword(result.get("crossword_skipped"), result.get("crossword_confirmed"))
        report_word_search_fallback(result.get("word_search_fallback"))
        report_evidence_rules(result.get("evidence_rules"))
        mode_str = "[dry-run] " if result.get("dry_run") else ""
        action = (
            "promoted from next/"
            if result.get("promoted_from_next")
            else "already published"
            if result.get("already_published")
            else "generated"
        )
        print(
            f"{mode_str}Daily puzzles for {result['reference_date']} {action} and verified successfully in {result['output_dir']}"
        )
        report_clue_coverage(result["output_dir"], mode_str)
        report_catalog(result.get("catalog"), mode_str, result.get("catalog_skipped"))
        if "next" in result:
            report_reused_grid(result["next"].get("grid_reused"))
            report_skipped_grid(result["next"].get("grid_skipped"))
            report_skipped_code_groups(result["next"].get("code_groups_skipped"))
            report_skipped_games(result["next"])
            report_skipped_crossword(result["next"].get("crossword_skipped"))
            report_word_search_fallback(result["next"].get("word_search_fallback"))
            print(f"{mode_str}Daily puzzles for {result['next']['reference_date']} published ahead in {result['next']['output_dir']}")
            report_clue_coverage(result["next"]["output_dir"], mode_str)
        report_skipped_next_day(result.get("next_skipped"))
        return 0
    except Exception as exc:
        # Each game is isolated in the runner, so this is a failure of the
        # whole day: no game generated, or a set that does not verify.
        sys.stderr.write(f"Daily puzzles generation failed: {single_line(str(exc))}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
