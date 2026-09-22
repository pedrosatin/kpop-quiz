"""Store deterministic group-relevance scores from collected source data."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

from .group_relevance_scoring import RelevanceScoreError, store_relevance_scores
from .storage import Repository


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Calculate group-relevance scores")
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        with Repository(args.database) as repository:
            run_id = store_relevance_scores(repository.connection)
    except (OSError, sqlite3.Error, RelevanceScoreError) as exc:
        parser.exit(1, f"Relevance scoring failed: {exc}\n")
    print(f"Stored group relevance run {run_id} in {args.database}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
