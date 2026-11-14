"""CLI for collecting K-pop source pages."""

import argparse
import os
import sys
from pathlib import Path

from .catalog import classify_catalog
from .collector import collect_category
from .exit_codes import EXIT_DETERMINISTIC, EXIT_OK, EXIT_TRANSIENT
from .fact_pipeline import extract_facts
from .http_request import DEFAULT_USER_AGENT
from .mediawiki import MaxlagBudget, MediaWikiClient, MediaWikiError
from .reports import export_fact_coverage_csv, export_release_coverage_csv
from .release_discovery import (
    MAX_CANDIDATES_PER_GROUP,
    MAX_GROUPS_PER_QUERY,
    TruncatedGroup,
    WikidataQueryClient,
    discover_releases,
)
from .release_pipeline import collect_release_facts
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
    parser.add_argument("--releases", action="store_true", help="Discover and confirm releases after fact extraction")
    parser.add_argument("--release-group-limit", type=int, default=MAX_GROUPS_PER_QUERY)
    parser.add_argument("--release-group-offset", type=int, default=0)
    parser.add_argument("--release-report", type=Path, help="Release coverage CSV path; implies --releases")
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
    parser.add_argument(
        "--person-evidence",
        action="store_true",
        help=(
            "Collect the Wikipedia page of each person and let its infobox prove born_on "
            "and born_in (ADR 027). Off by default, and never implied by --facts or "
            "--releases. Without it, facts this rule already accepted are kept from the "
            "stored revisions and no new fact is accepted from it. Requires --facts, "
            "--facts-limit, --facts-report or --releases, and a copy of the database: "
            "the default database and its raw directory are refused"
        ),
    )
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    return parser


def _check_person_evidence_target(run_facts: bool, database: Path, raw_dir: Path) -> None:
    """Reject the default database and raw directory for --person-evidence."""
    if not run_facts:
        raise SystemExit(
            "--person-evidence needs the fact stage: add --facts, --facts-limit, "
            "--facts-report or --releases"
        )
    default_raw = DEFAULT_DATABASE.parent / "raw"
    if database.resolve() == DEFAULT_DATABASE.resolve() or raw_dir.resolve() == default_raw.resolve():
        raise SystemExit(
            "--person-evidence refuses the default paths: pass --database (and --raw-dir) pointing "
            "at a copy of data/kpop.db and data/raw, never the default database or its raw directory"
        )


def _print_birth_coverage(totals) -> None:
    """Print the born_on/born_in outcome counts before and after the fact run."""
    for before, after in zip(totals.birth_before, totals.birth_after):
        print(
            f"Birth coverage {before.predicate}: "
            f"{_coverage(before)} -> {_coverage(after)}"
        )


def _coverage(row) -> str:
    return (
        f"{row.accepted}/{row.total} accepted ({row.accepted_by_person_page} by person page), "
        f"{row.rejected_for_evidence} rejected for evidence, "
        f"{row.rejected_by_person_page} rejected by person page"
    )


def report_truncated_groups(truncated: tuple[TruncatedGroup, ...]) -> None:
    """Warn about each group the per-group candidate limit cut; the run goes on.

    The message holds only the group QID, which comes from the database and
    passed ``build_query`` (``Q`` and ASCII digits without leading zeros), and
    counts: no text from the WDQS answer reaches the workflow command. The
    annotation is flushed at once: in GitHub Actions stdout is a pipe, so
    Python buffers it, and the SIGTERM of the rebuild script's attempt timeout
    would drop a buffered line.
    """
    for group in truncated:
        message = (
            f"WDQS returned {group.candidates} release candidates for group {group.group_id}; "
            f"kept the {group.kept} with the lowest QIDs and discarded {group.discarded}"
        )
        sys.stderr.write(f"WARNING: {message}\n")
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::warning title=Release candidates truncated::{message}", flush=True)


def _failure_exit_code(exc: Exception) -> int:
    """Tell a failure that may pass on a later run from one that will repeat."""
    if isinstance(exc, MediaWikiError) and exc.transient:
        return EXIT_TRANSIENT
    return EXIT_DETERMINISTIC


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be greater than zero")
    if not args.user_agent.strip():
        raise SystemExit("--user-agent must not be empty")
    if args.facts_limit is not None and args.facts_limit < 1:
        raise SystemExit("--facts-limit must be greater than zero")
    run_releases = args.releases or args.release_report is not None
    if not 1 <= args.release_group_limit <= MAX_GROUPS_PER_QUERY:
        raise SystemExit(f"--release-group-limit must be between 1 and {MAX_GROUPS_PER_QUERY}")
    if args.release_group_offset < 0:
        raise SystemExit("--release-group-offset must not be negative")
    run_facts = args.facts or args.facts_limit is not None or args.facts_report is not None or run_releases
    facts_report = args.facts_report or args.database.parent / "facts-coverage.csv"
    raw_dir = args.raw_dir or args.database.parent / "raw"
    if args.person_evidence:
        _check_person_evidence_target(run_facts, args.database, raw_dir)
    catalog_report = args.catalog_report or args.database.parent / "catalog-report.csv"
    try:
        # One budget for every Wikipedia and Wikidata client of the run.
        maxlag_budget = MaxlagBudget.from_environment(os.environ)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    try:
        with Repository(args.database, raw_dir=raw_dir) as repository:
            count = collect_category(
                MediaWikiClient(user_agent=args.user_agent, maxlag_budget=maxlag_budget),
                repository,
                args.category,
                args.limit,
            )
            stats = classify_catalog(
                repository,
                WikidataTypeClient(user_agent=args.user_agent, maxlag_budget=maxlag_budget),
            )
            report_rows = repository.export_catalog_csv(catalog_report)
            fact_totals = fact_rows = None
            if run_facts:
                wikipedia = MediaWikiClient(user_agent=args.user_agent, maxlag_budget=maxlag_budget)
                fact_totals = extract_facts(
                    repository,
                    WikidataEntityClient(user_agent=args.user_agent, maxlag_budget=maxlag_budget),
                    group_limit=args.facts_limit,
                    wikitext_client=wikipedia,
                    person_client=wikipedia if args.person_evidence else None,
                )
                fact_rows = export_fact_coverage_csv(repository.connection, facts_report)
            release_totals = release_rows = discovery = None
            if run_releases:
                discovery = discover_releases(
                    repository,
                    WikidataQueryClient(user_agent=args.user_agent),
                    group_limit=args.release_group_limit,
                    group_offset=args.release_group_offset,
                )
                report_truncated_groups(discovery.truncated)
                wikipedia_clients = {
                    language: MediaWikiClient(
                        api_url=f"https://{language}.wikipedia.org/w/api.php",
                        user_agent=args.user_agent,
                        language=language,
                        maxlag_budget=maxlag_budget,
                    )
                    for language in ("en", "pt", "ko")
                }
                release_totals = collect_release_facts(
                    repository,
                    WikidataEntityClient(user_agent=args.user_agent, maxlag_budget=maxlag_budget),
                    discovery.run_id,
                    wikipedia_clients=wikipedia_clients,
                )
                release_rows = export_release_coverage_csv(repository.connection, args.release_report or args.database.parent / "release-coverage.csv")
    except (MediaWikiError, SnapshotIntegrityError, RuntimeError, ValueError) as exc:
        print(f"Pipeline failed: {type(exc).__name__}: {exc}")
        return _failure_exit_code(exc)
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
        _print_birth_coverage(fact_totals)
    if release_totals is not None:
        print(
            f"Releases: {release_totals.groups} discovery groups, "
            f"{release_totals.entities} release entities saved; "
            f"{release_totals.accepted} accepted facts, "
            f"{release_totals.rejected} rejected, "
            f"{release_totals.conflict} conflict; "
            f"{release_rows} coverage rows"
        )
        truncated = len(discovery.truncated)
        if truncated:
            print(
                f"Release discovery: {truncated} group{'s' if truncated > 1 else ''} "
                f"truncated at {MAX_CANDIDATES_PER_GROUP} candidates"
            )
    return EXIT_OK
