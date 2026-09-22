import sqlite3
import unittest

from kpop_scraping.group_relevance_scoring import (
    RelevanceScoreError,
    latest_complete_pageviews,
    load_latest_relevance_scores,
    percentile_scores,
    score_groups,
    store_relevance_scores,
)
from kpop_scraping.quiz_rendering import _group_relevance_score


def relevance_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE entities(id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT);
        CREATE TABLE source_pages(
            id INTEGER PRIMARY KEY, provider TEXT, language TEXT, title TEXT
        );
        CREATE TABLE catalog_entries(source_page_id INTEGER, state TEXT);
        CREATE TABLE catalog_entity_links(entity_id INTEGER, source_page_id INTEGER);
        CREATE TABLE group_pageview_runs(
            id INTEGER PRIMARY KEY, status TEXT, completed_at TEXT,
            start_date TEXT, end_date TEXT
        );
        CREATE TABLE group_pageviews(
            run_id INTEGER, entity_id INTEGER, page_title TEXT, total_views INTEGER,
            start_date TEXT, end_date TEXT, days_observed INTEGER
        );
        CREATE TABLE group_relevance_runs(
            id INTEGER PRIMARY KEY, pageview_run_id INTEGER, algorithm_version TEXT,
            youtube_report_json TEXT, youtube_report_sha256 TEXT,
            accepted_groups INTEGER, pageview_groups INTEGER,
            youtube_subscriber_groups INTEGER, youtube_view_groups INTEGER,
            created_at TEXT
        );
        CREATE TABLE group_relevance_scores(
            run_id INTEGER, entity_id INTEGER, pageviews INTEGER,
            youtube_subscribers INTEGER, youtube_views INTEGER,
            pageview_percentile INTEGER, subscriber_percentile INTEGER,
            youtube_view_percentile INTEGER, relevance_score INTEGER
        );
        INSERT INTO entities VALUES (1,'Q1','group'),(2,'Q2','group');
        INSERT INTO source_pages VALUES
            (10,'wikipedia','en','Alpha'),(11,'wikipedia','en','Beta');
        INSERT INTO catalog_entries VALUES (10,'accepted'),(11,'accepted');
        INSERT INTO catalog_entity_links VALUES (1,10),(2,11);
        """
    )
    return connection


class GroupRelevanceScoringTest(unittest.TestCase):
    def test_missing_group_is_not_scored_as_zero_views(self):
        self.assertIsNone(_group_relevance_score(("Q1", "Q2"), {"Q1": 10}))
        self.assertEqual(_group_relevance_score(("Q1", "Q2"), {"Q1": 10, "Q2": 3}), 10)
        self.assertEqual(_group_relevance_score(("Q1",), {"Q1": 0}), 0)
        self.assertIsNone(_group_relevance_score(("Q1",), {}))

    def test_pageview_snapshot_uses_one_complete_run(self):
        connection = relevance_database()
        self.addCleanup(connection.close)
        connection.execute(
            """INSERT INTO group_pageview_runs(id,status,completed_at,start_date,end_date)
               VALUES (1,'completed','2026-09-01T00:00:00+00:00','2026-08-01','2026-08-30')"""
        )
        connection.execute(
            """INSERT INTO group_pageviews(
                   run_id,entity_id,page_title,total_views,start_date,end_date,days_observed
               ) VALUES (1,1,'Alpha',999999,'2026-08-01','2026-08-30',30)"""
        )
        self.assertIsNone(latest_complete_pageviews(connection))
        connection.execute(
            """INSERT INTO group_pageview_runs(id,status,completed_at,start_date,end_date)
               VALUES (2,'completed','2026-09-22T00:00:00+00:00','2025-09-21','2026-09-20')"""
        )
        connection.execute(
            """INSERT INTO group_pageviews(
                   run_id,entity_id,page_title,total_views,start_date,end_date,days_observed
               ) VALUES (2,1,'Alpha',1200,'2025-09-21','2026-09-20',365)"""
        )
        self.assertIsNone(latest_complete_pageviews(connection))
        connection.execute(
            """INSERT INTO group_pageviews(
                   run_id,entity_id,page_title,total_views,start_date,end_date,days_observed
               ) VALUES (2,2,'Beta',80000,'2025-09-21','2026-09-20',60)"""
        )
        self.assertEqual(latest_complete_pageviews(connection), (2, {"Q1": 1200, "Q2": 80000}))
        connection.execute(
            """INSERT INTO group_pageview_runs(id,status,completed_at,start_date,end_date)
               VALUES (3,'completed','2026-09-23T00:00:00+00:00','2025-09-22','2026-09-21')"""
        )
        connection.execute(
            """INSERT INTO group_pageviews(
                   run_id,entity_id,page_title,total_views,start_date,end_date,days_observed
               ) VALUES (3,1,'Alpha',999999,'2025-09-22','2026-09-21',365)"""
        )
        self.assertEqual(latest_complete_pageviews(connection), (2, {"Q1": 1200, "Q2": 80000}))
        connection.execute("UPDATE source_pages SET title='Renamed Alpha' WHERE id=10")
        self.assertIsNone(latest_complete_pageviews(connection))

    def test_percentiles_share_tied_ranks(self):
        self.assertEqual(
            percentile_scores({"Q1": 10, "Q2": 20, "Q3": 20, "Q4": 40}),
            {"Q1": 0, "Q2": 5000, "Q3": 5000, "Q4": 10000},
        )

    def test_score_is_the_pageview_percentile(self):
        rows = score_groups({"Q1": 100, "Q2": 200, "Q3": 300})
        self.assertEqual(
            {row["wikidata_id"]: row["relevance_score"] for row in rows},
            {"Q1": 0, "Q2": 5000, "Q3": 10000},
        )
        self.assertTrue(all(row["youtube_views"] is None for row in rows))
        self.assertTrue(all(row["youtube_subscribers"] is None for row in rows))

    def test_score_run_persists_pageview_coverage_without_youtube_data(self):
        connection = relevance_database()
        self.addCleanup(connection.close)
        connection.execute(
            """INSERT INTO group_pageview_runs VALUES (
                1,'completed','2026-09-22T00:00:00+00:00','2025-09-21','2026-09-20'
            )"""
        )
        connection.executemany(
            """INSERT INTO group_pageviews VALUES
               (?,?,?,?,?,?,?)""",
            [
                (1, 1, "Alpha", 100, "2025-09-21", "2026-09-20", 365),
                (1, 2, "Beta", 200, "2025-09-21", "2026-09-20", 365),
            ],
        )

        run_id = store_relevance_scores(connection)
        self.assertTrue(connection.in_transaction)

        stored = connection.execute(
            """SELECT accepted_groups,pageview_groups,youtube_subscriber_groups,
                      youtube_view_groups,youtube_report_json,youtube_report_sha256
               FROM group_relevance_runs WHERE id=?""",
            (run_id,),
        ).fetchone()
        self.assertEqual(tuple(stored[:4]), (2, 2, 0, 0))
        self.assertIsNone(stored[4])
        self.assertIsNone(stored[5])
        connection.execute(
            """INSERT INTO group_relevance_runs VALUES (
                2,1,'experimental-composite',NULL,NULL,2,2,0,0,'2099-01-01T00:00:00+00:00'
            )"""
        )
        connection.executemany(
            """INSERT INTO group_relevance_scores(
                   run_id,entity_id,pageviews,pageview_percentile,relevance_score
               ) VALUES (?,?,?,?,?)""",
            [(2, 1, 100, 10000, 10000), (2, 2, 200, 0, 0)],
        )
        self.assertEqual(load_latest_relevance_scores(connection), {"Q1": 0, "Q2": 10000})

    def test_score_run_starts_a_write_transaction_before_reading_inputs(self):
        connection = relevance_database()
        self.addCleanup(connection.close)
        connection.execute(
            """INSERT INTO group_pageview_runs VALUES (
                1,'completed','2026-09-22T00:00:00+00:00','2025-09-21','2026-09-20'
            )"""
        )
        connection.executemany(
            "INSERT INTO group_pageviews VALUES (?,?,?,?,?,?,?)",
            [
                (1, 1, "Alpha", 100, "2025-09-21", "2026-09-20", 365),
                (1, 2, "Beta", 200, "2025-09-21", "2026-09-20", 365),
            ],
        )
        connection.commit()
        statements = []
        connection.set_trace_callback(statements.append)

        store_relevance_scores(connection)

        self.assertFalse(connection.in_transaction)
        begin_index = next(
            index for index, statement in enumerate(statements)
            if statement == "BEGIN IMMEDIATE"
        )
        first_select_index = next(
            index for index, statement in enumerate(statements)
            if statement.lstrip().startswith("SELECT")
        )
        self.assertLess(begin_index, first_select_index)

    def test_score_run_requires_complete_pageview_coverage(self):
        connection = relevance_database()
        self.addCleanup(connection.close)
        with self.assertRaisesRegex(RelevanceScoreError, "no complete"):
            store_relevance_scores(connection)
