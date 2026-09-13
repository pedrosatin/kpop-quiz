"""CLI for collecting K-pop source pages."""

import argparse
from pathlib import Path

from .catalog import classify_catalog
from .collector import collect_category
from .fact_pipeline import extract_facts
from .mediawiki import MediaWikiClient, MediaWikiError
from .reports import export_fact_coverage_csv
from .storage import Repository, SnapshotIntegrityError
from .wikidata import WikidataEntityClient, WikidataTypeClient


DEFAULT_CATEGORY = "Category:K-pop music groups"
DEFAULT_DATABASE = Path(__file__).resolve().parent.parent / "data" / "kpop.db"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect K-pop pages from Wikipedia")
    parser.add_argument("--category", default=DEFAULT_CATEGORY)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument(
        "--raw-dir",
        type=Path,
        help="Snapshot directory; defaults to a raw directory beside the database",
    )
    parser.add_argument(
        "--catalog-report",
        type=Path,
        help="CSV report path; defaults to catalog-report.csv beside the database",
    )
    parser.add_argument("--limit", type=int, help="Collect only the first N pages")
    parser.add_argument(
        "--facts",
        action="store_true",
        help="Extract Wikidata facts for accepted catalog groups after classification",
    )
    parser.add_argument(
        "--facts-limit",
        type=int,
        help="Extract facts for at most N accepted groups; implies --facts",
    )
    parser.add_argument(
        "--facts-report",
        type=Path,
        help=(
            "Fact coverage CSV path; implies --facts. "
            "Defaults to facts-coverage.csv beside the database"
        ),
    )
    parser.add_argument("--user-agent", default="kpop-quiz/0.1 (https://github.com/pedrosatin/kpop-scraping)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be greater than zero")
    if not args.user_agent.strip():
        raise SystemExit("--user-agent must not be empty")
    if args.facts_limit is not None and args.facts_limit < 1:
        raise SystemExit("--facts-limit must be greater than zero")
    run_facts = args.facts or args.facts_limit is not None or args.facts_report is not None
    facts_report = args.facts_report or args.database.parent / "facts-coverage.csv"
    raw_dir = args.raw_dir or args.database.parent / "raw"
    catalog_report = args.catalog_report or args.database.parent / "catalog-report.csv"
    try:
        with Repository(args.database, raw_dir=raw_dir) as repository:
            count = collect_category(
                MediaWikiClient(user_agent=args.user_agent),
                repository,
                args.category,
                args.limit,
            )
            stats = classify_catalog(
                repository,
                WikidataTypeClient(user_agent=args.user_agent),
            )
            report_rows = repository.export_catalog_csv(catalog_report)
            fact_totals = fact_rows = None
            if run_facts:
                fact_totals = extract_facts(
                    repository,
                    WikidataEntityClient(user_agent=args.user_agent),
                    group_limit=args.facts_limit,
                )
                fact_rows = export_fact_coverage_csv(repository.connection, facts_report)
    except (MediaWikiError, SnapshotIntegrityError, RuntimeError) as exc:
        print(f"Pipeline failed: {type(exc).__name__}: {exc}")
        return 1
    print(f"Collected {count} pages into {args.database}; snapshots in {raw_dir}")
    print(
        f"Catalog: {stats.accepted} accepted, {stats.rejected} rejected, "
        f"{stats.pending} pending; {report_rows} rows in {catalog_report}"
    )
    if fact_totals is not None:
        print(
            f"Facts: {fact_totals.groups} groups, {fact_totals.entities} entities, "
            f"{fact_totals.batches} Wikidata batches; {fact_totals.accepted} accepted, "
            f"{fact_totals.rejected} rejected, {fact_totals.conflict} conflict, "
            f"{fact_totals.superseded} superseded, {fact_totals.stale} stale; "
            f"{fact_rows} rows in {facts_report}"
        )
    return 0
