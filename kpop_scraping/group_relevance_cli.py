"""Collect the cached pageview relevance inputs used by quiz session selection."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from pathlib import Path

from .group_relevance import PageviewClient, PageviewError, WINDOW_DAYS, collect_group_pageviews
from .storage import Repository


def default_reference_date() -> date:
    """Return the current UTC date used to close the Pageviews window."""
    return datetime.now(timezone.utc).date()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect group Wikipedia pageviews")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--reference-date", type=date.fromisoformat, default=default_reference_date())
    parser.add_argument("--days", type=int, default=WINDOW_DAYS)
    parser.add_argument("--limit", type=int, help="Collect at most this many accepted groups")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--user-agent", required=True)
    args = parser.parse_args(argv)
    if args.days < 1 or args.limit is not None and args.limit < 1:
        parser.error("--days and --limit must be positive")
    try:
        with Repository(args.database) as repository:
            count = collect_group_pageviews(
                repository, PageviewClient(args.user_agent, args.timeout, args.retries),
                args.reference_date, args.days, args.limit,
            )
    except (PageviewError, RuntimeError, ValueError) as exc:
        parser.exit(1, f"Pageview collection failed: {exc}\n")
    print(f"Collected {count} group pageview measurements into {args.database}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
