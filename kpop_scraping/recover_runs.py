"""Inspect unfinished run records and explicitly close an interrupted run."""
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

RUN_TABLES = (
    "collection_runs", "catalog_runs", "fact_runs",
    "release_discovery_runs", "group_pageview_runs",
)


def unfinished_runs(connection: sqlite3.Connection) -> list[dict]:
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = []
    for table in RUN_TABLES:
        if table not in tables:
            continue
        for run_id, started_at in connection.execute(
            f"SELECT id, started_at FROM {table} WHERE status='running' ORDER BY id"
        ):
            result.append({"table": table, "id": run_id, "started_at": started_at})
    return result


def close_interrupted_run(connection: sqlite3.Connection, table: str, run_id: int) -> None:
    if table not in RUN_TABLES or run_id < 1:
        raise ValueError("Invalid run identity")
    cursor = connection.execute(
        f"UPDATE {table} SET status='failed', completed_at=?, error=? WHERE id=? AND status='running'",
        (datetime.now(timezone.utc).isoformat(), "Interrupted run closed by operator", run_id),
    )
    if cursor.rowcount != 1:
        raise ValueError("Run does not exist or is already finished")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--fail-run", help="TABLE:ID of a run whose process has stopped; otherwise list only")
    args = parser.parse_args(argv)
    mode = "rw" if args.fail_run else "ro"
    connection = sqlite3.connect(f"{args.database.resolve().as_uri()}?mode={mode}", uri=True)
    try:
        with connection:
            if args.fail_run:
                table, run_id = args.fail_run.rsplit(":", 1)
                close_interrupted_run(connection, table, int(run_id))
            print(json.dumps(unfinished_runs(connection), indent=2))
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
