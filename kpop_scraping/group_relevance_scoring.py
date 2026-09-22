"""Calculate a reproducible group-relevance score from Wikipedia pageviews."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping

from .group_relevance import WINDOW_DAYS, _article_key


ALGORITHM_VERSION = "group-relevance-pageview-percentiles-v1"
MAX_SCORE = 10_000
ASSISTED_MIN_SCORE = 6_667
EXPERT_MAX_SCORE = 3_333


class RelevanceScoreError(ValueError):
    """The stored inputs cannot produce a complete relevance snapshot."""


def percentile_scores(values: Mapping[str, int]) -> dict[str, int]:
    """Return tie-aware percentile ranks as integers from 0 through 10,000."""
    if not values:
        return {}
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    if len(ordered) == 1:
        return {ordered[0][0]: MAX_SCORE // 2}
    scores: dict[str, int] = {}
    start = 0
    while start < len(ordered):
        end = start
        while end + 1 < len(ordered) and ordered[end + 1][1] == ordered[start][1]:
            end += 1
        numerator = (start + end) * MAX_SCORE
        denominator = 2 * (len(ordered) - 1)
        score = (numerator + denominator // 2) // denominator
        for index in range(start, end + 1):
            scores[ordered[index][0]] = score
        start = end + 1
    return scores


def score_groups(
    pageviews: Mapping[str, int],
) -> list[dict[str, int | str | None]]:
    """Use the catalog-wide Wikipedia pageview percentile as relevance."""
    if not pageviews:
        raise RelevanceScoreError("pageview snapshot is empty")
    pageview_ranks = percentile_scores(pageviews)
    rows = []
    for qid in sorted(pageviews):
        pageview_rank = pageview_ranks[qid]
        rows.append(
            {
                "wikidata_id": qid,
                "pageviews": pageviews[qid],
                "youtube_subscribers": None,
                "youtube_views": None,
                "pageview_percentile": pageview_rank,
                "subscriber_percentile": None,
                "youtube_view_percentile": None,
                "relevance_score": pageview_rank,
            }
        )
    return rows


def latest_complete_pageviews(connection: sqlite3.Connection) -> tuple[int, dict[str, int]] | None:
    """Return the newest single run covering every accepted English group."""
    connection.row_factory = sqlite3.Row
    try:
        accepted_rows = connection.execute(
            """
            SELECT e.id, e.wikidata_id, MIN(sp.title) AS page_title
            FROM entities e
            JOIN catalog_entity_links cel ON cel.entity_id=e.id
            JOIN source_pages sp ON sp.id=cel.source_page_id
            JOIN catalog_entries ce ON ce.source_page_id=sp.id
            WHERE e.entity_type='group' AND ce.state='accepted'
              AND sp.provider='wikipedia' AND sp.language='en'
            GROUP BY e.id, e.wikidata_id
            """
        ).fetchall()
        runs = connection.execute(
            """
            SELECT id FROM group_pageview_runs
            WHERE status='completed'
              AND CAST(julianday(end_date) - julianday(start_date) AS INTEGER) + 1 = ?
            ORDER BY completed_at DESC, id DESC
            """,
            (WINDOW_DAYS,),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return None
        raise
    accepted = {
        int(row["id"]): (str(row["wikidata_id"]), _article_key(str(row["page_title"])))
        for row in accepted_rows
    }
    if not accepted:
        return None
    for run in runs:
        measurements = connection.execute(
            """
            SELECT gp.entity_id, gp.page_title, gp.total_views
            FROM group_pageviews gp
            JOIN group_pageview_runs gr ON gr.id=gp.run_id
            WHERE gp.run_id=? AND gp.start_date=gr.start_date
              AND gp.end_date=gr.end_date AND gp.days_observed>=1
            """,
            (run["id"],),
        ).fetchall()
        by_entity = {
            int(row["entity_id"]): (int(row["total_views"]), _article_key(str(row["page_title"])))
            for row in measurements
        }
        titles_match = all(
            by_entity[entity_id][1] == accepted[entity_id][1]
            for entity_id in set(by_entity) & set(accepted)
        )
        if (
            len(measurements) == len(by_entity)
            and set(by_entity) == set(accepted)
            and titles_match
        ):
            return int(run["id"]), {
                accepted[entity_id][0]: total_and_title[0]
                for entity_id, total_and_title in by_entity.items()
            }
    return None


def store_relevance_scores(connection: sqlite3.Connection) -> int:
    """Calculate and store a complete score snapshot in one transaction."""
    owns_transaction = not connection.in_transaction
    savepoint = "group_relevance_score"
    try:
        if owns_transaction:
            connection.execute("BEGIN IMMEDIATE")
        else:
            connection.execute(f"SAVEPOINT {savepoint}")
        snapshot = latest_complete_pageviews(connection)
        if snapshot is None:
            raise RelevanceScoreError("no complete 365-day pageview run is available")
        pageview_run_id, pageviews = snapshot
        rows = score_groups(pageviews)
        cursor = connection.execute(
            """INSERT INTO group_relevance_runs(
                pageview_run_id,algorithm_version,youtube_report_json,youtube_report_sha256,
                accepted_groups,pageview_groups,youtube_subscriber_groups,youtube_view_groups,created_at
            ) VALUES (?,?,?,?,?,?,?,?,datetime('now'))""",
            (
                pageview_run_id,
                ALGORITHM_VERSION,
                None,
                None,
                len(rows),
                len(pageviews),
                0,
                0,
            ),
        )
        run_id = int(cursor.lastrowid)
        entity_ids = {
            str(row["wikidata_id"]): int(row["id"])
            for row in connection.execute("SELECT id,wikidata_id FROM entities")
        }
        connection.executemany(
            """INSERT INTO group_relevance_scores(
                run_id,entity_id,pageviews,youtube_subscribers,youtube_views,
                pageview_percentile,subscriber_percentile,youtube_view_percentile,relevance_score
            ) VALUES (?,?,?,?,?,?,?,?,?)""",
            [
                (
                    run_id,
                    entity_ids[str(row["wikidata_id"])],
                    row["pageviews"],
                    row["youtube_subscribers"],
                    row["youtube_views"],
                    row["pageview_percentile"],
                    row["subscriber_percentile"],
                    row["youtube_view_percentile"],
                    row["relevance_score"],
                )
                for row in rows
            ],
        )
        if owns_transaction:
            connection.commit()
        else:
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
    except Exception:
        if owns_transaction:
            connection.rollback()
        else:
            connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        raise
    return run_id


def load_latest_relevance_scores(connection: sqlite3.Connection) -> dict[str, int]:
    """Load the newest score run only when it covers the accepted catalog."""
    connection.row_factory = sqlite3.Row
    try:
        accepted = {
            str(row["wikidata_id"])
            for row in connection.execute(
                """
                SELECT DISTINCT e.wikidata_id
                FROM entities e
                JOIN catalog_entity_links cel ON cel.entity_id=e.id
                JOIN source_pages sp ON sp.id=cel.source_page_id
                JOIN catalog_entries ce ON ce.source_page_id=sp.id
                WHERE e.entity_type='group' AND ce.state='accepted'
                  AND sp.provider='wikipedia' AND sp.language='en'
                """
            )
        }
        runs = connection.execute(
            """SELECT id FROM group_relevance_runs
               WHERE algorithm_version=?
               ORDER BY created_at DESC,id DESC""",
            (ALGORITHM_VERSION,),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return {}
        raise
    for run in runs:
        rows = connection.execute(
            """SELECT e.wikidata_id,s.relevance_score
               FROM group_relevance_scores s JOIN entities e ON e.id=s.entity_id
               WHERE s.run_id=?""",
            (run["id"],),
        ).fetchall()
        scores = {str(row["wikidata_id"]): int(row["relevance_score"]) for row in rows}
        if accepted and len(rows) == len(scores) and set(scores) == accepted:
            return scores
    return {}
