"""Collect Wikidata YouTube signals for accepted quiz groups.

The command writes a JSON report. It does not change quiz sessions. Pass a
YouTube Data API key only when live subscriber and view counts are wanted.
Search volume on Google is not collected. There is no public API for it.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .group_signals import (
    SignalError,
    extract_group_signals,
    fetch_youtube_statistics,
    select_rankable_signals,
)
from .wikidata import MAX_ENTITIES_PER_REQUEST, EntityProfile, WikidataEntityClient

CLAIMS_PROFILE = EntityProfile(name="youtube-signals-v1", props="claims|info")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect YouTube signals for accepted groups")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument(
        "--user-agent",
        default="kpop-quiz-group-signals/1.0 (https://github.com/pedrosatin/kpop-scraping)",
    )
    args = parser.parse_args(argv)
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if args.pause_seconds < 0:
        parser.error("--pause-seconds cannot be negative")
    try:
        groups = load_accepted_groups(args.database, args.limit)
        report = collect_report(
            groups,
            args.user_agent,
            args.pause_seconds,
            os.environ.get("YOUTUBE_API_KEY", ""),
        )
    except (SignalError, sqlite3.Error, OSError, RuntimeError, ValueError) as exc:
        parser.exit(1, f"Group signal collection failed: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = report["summary"]
    print(
        f"Wrote {args.output}: {summary['groups']} groups, "
        f"{summary['with_channel_id']} with a YouTube channel, "
        f"{summary['usable_for_rank']} with a rankable subscriber snapshot"
    )
    return 0


def load_accepted_groups(database: Path, limit: int | None) -> list[dict[str, Any]]:
    """Read accepted groups and their English Wikipedia titles. The database stays read-only."""
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        connection.row_factory = sqlite3.Row
        query = """
            SELECT DISTINCT e.wikidata_id, e.canonical_name, sp.title AS enwiki_title
            FROM entities e
            JOIN catalog_entity_links cel ON cel.entity_id=e.id
            JOIN source_pages sp ON sp.id=cel.source_page_id
            JOIN catalog_entries ce ON ce.source_page_id=sp.id
            WHERE e.entity_type='group' AND ce.state='accepted'
              AND sp.provider='wikipedia' AND sp.language='en'
            ORDER BY e.wikidata_id
        """
        if limit is not None:
            query += f" LIMIT {int(limit)}"
        return [dict(row) for row in connection.execute(query)]
    finally:
        connection.close()


def collect_report(
    groups: list[dict[str, Any]],
    user_agent: str,
    pause_seconds: float,
    youtube_api_key: str,
) -> dict[str, Any]:
    client = WikidataEntityClient(user_agent=user_agent)
    rows = []
    for start in range(0, len(groups), MAX_ENTITIES_PER_REQUEST):
        if start:
            time.sleep(pause_seconds)
        batch = groups[start : start + MAX_ENTITIES_PER_REQUEST]
        documents = {
            document.requested_id: document
            for document in client.get_entities(
                [group["wikidata_id"] for group in batch], CLAIMS_PROFILE
            ).documents
        }
        for group in batch:
            document = documents.get(group["wikidata_id"])
            signals = extract_group_signals(document.payload if document else {})
            rows.append(
                {
                    **group,
                    **signals,
                    "wikidata_found": document is not None,
                    "wikidata_resolved_id": document.wikidata_id if document else None,
                    "wikidata_revision_id": document.revision_id if document else None,
                }
            )
    select_rankable_signals(rows)
    if youtube_api_key:
        _attach_live_statistics(rows, youtube_api_key, pause_seconds)
    with_channel = sum(bool(row["channels"]) for row in rows)
    with_snapshot = sum(row["selected_subscribers"] is not None for row in rows)
    usable = sum(bool(row["usable_for_rank"]) for row in rows)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "groups": len(rows),
            "with_channel_id": with_channel,
            "with_subscriber_snapshot": with_snapshot,
            "usable_for_rank": usable,
            "shared_channel_groups": sum(
                any(channel.get("shared") for channel in row["channels"]) for row in rows
            ),
            "live_youtube_statistics": bool(youtube_api_key),
            "google_search_volume": None,
        },
        "groups": rows,
    }


def _attach_live_statistics(rows: list[dict[str, Any]], api_key: str, pause_seconds: float) -> None:
    channel_ids = sorted({channel["id"] for row in rows for channel in row["channels"]})
    statistics: dict[str, dict[str, int | bool | None]] = {}
    for start in range(0, len(channel_ids), 50):
        if start:
            time.sleep(pause_seconds)
        statistics.update(fetch_youtube_statistics(channel_ids[start : start + 50], api_key))
    for row in rows:
        row["live_statistics"] = [
            {"channel_id": channel["id"], **statistics[channel["id"]]}
            for channel in row["channels"]
            if channel["id"] in statistics
        ]


if __name__ == "__main__":
    raise SystemExit(main())
