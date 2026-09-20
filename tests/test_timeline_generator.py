"""Unit tests for the deterministic timeline puzzle generator and CLI."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from kpop_scraping import timeline_cli
from kpop_scraping.timeline_generator import (
    format_display_date,
    generate_timeline_puzzle,
)
from kpop_scraping.timeline_schema import (
    TIMELINE_MIN_EVENT_GAP_DAYS,
    timeline_date_span,
    validate_timeline_puzzle,
)
from tests.test_daily_puzzles_runner import build_test_database, person_wikidata_id


class FormatDisplayDateTests(unittest.TestCase):
    def test_year_month_and_day_precisions(self):
        self.assertEqual(format_display_date("2015"), {"pt-BR": "2015", "en": "2015"})
        self.assertEqual(
            format_display_date("2015-07"),
            {"pt-BR": "Julho de 2015", "en": "July 2015"},
        )
        self.assertEqual(
            format_display_date("2015-07-20"),
            {"pt-BR": "20 de julho de 2015", "en": "July 20, 2015"},
        )


class TimelineGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "kpop.db"
        conn = build_test_database(self.db_path)
        conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _connect_readonly(self) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def test_deterministic_for_same_date(self):
        conn = self._connect_readonly()
        try:
            first = generate_timeline_puzzle(conn, reference_date=date(2026, 9, 18))
            second = generate_timeline_puzzle(conn, reference_date=date(2026, 9, 18))
        finally:
            conn.close()
        self.assertEqual(first, second)
        self.assertEqual(first["reference_date"], "2026-09-18")
        validate_timeline_puzzle(first)

    def test_different_date_yields_different_puzzle(self):
        conn = self._connect_readonly()
        try:
            first = generate_timeline_puzzle(conn, reference_date=date(2026, 9, 18))
            second = generate_timeline_puzzle(conn, reference_date=date(2026, 9, 19))
        finally:
            conn.close()
        self.assertNotEqual(first["puzzle_id"], second["puzzle_id"])

    def test_events_respect_minimum_gap_and_strict_order(self):
        conn = self._connect_readonly()
        try:
            for day in range(1, 15):
                puzzle = generate_timeline_puzzle(conn, reference_date=date(2026, 10, day))
                dates = [ev["date"] for ev in puzzle["events"]]
                self.assertEqual(dates, sorted(dates))
                spans = [timeline_date_span(d) for d in dates]
                for prev_span, curr_span in zip(spans, spans[1:]):
                    self.assertGreaterEqual(
                        (curr_span[0] - prev_span[1]).days,
                        TIMELINE_MIN_EVENT_GAP_DAYS,
                    )
        finally:
            conn.close()

    def test_skips_rejected_facts_and_non_qid_entities(self):
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.execute("UPDATE facts SET status = 'rejected' WHERE predicate = 'born_on'")
            conn.execute(
                "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
                ("QP_FAKE", "Fake Person"),
            )
            fake_id = conn.execute(
                "SELECT id FROM entities WHERE wikidata_id = 'QP_FAKE'"
            ).fetchone()[0]
            cur_b = conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    value_time, value_precision, status, quality_flags_json
                ) VALUES ('stmt-born-fake', ?, 'born_on', 'P569', 'normal', '1990-01-01', 11, 'accepted', '[]')
                """,
                (fake_id,),
            )
            conn.execute(
                """
                INSERT INTO fact_evidence(
                    fact_id, evidence_type, source_key, locator, reference_hash,
                    wikidata_snapshot_id
                ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P569/ref', 'ref1', 1)
                """,
                (cur_b.lastrowid,),
            )
            conn.commit()
        finally:
            conn.close()

        conn = self._connect_readonly()
        try:
            for day in range(1, 15):
                puzzle = generate_timeline_puzzle(conn, reference_date=date(2026, 10, day))
                entity_ids = {ev["entity_id"] for ev in puzzle["events"]}
                self.assertNotIn("QP_FAKE", entity_ids)
                self.assertNotIn(person_wikidata_id(101, 0), entity_ids)
                self.assertTrue(all(ev["event_type"] == "formation" for ev in puzzle["events"]))
        finally:
            conn.close()

    def test_insufficient_distinct_years_raises(self):
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.execute(
                """
                DELETE FROM facts WHERE predicate = 'formed_on'
                  AND CAST(substr(value_time, 1, 4) AS INTEGER) NOT IN (2004, 2012, 2015, 2021)
                """
            )
            conn.execute("DELETE FROM facts WHERE predicate = 'born_on'")
            conn.commit()
        finally:
            conn.close()

        conn = self._connect_readonly()
        try:
            with self.assertRaisesRegex(ValueError, "distinct years"):
                generate_timeline_puzzle(conn, reference_date=date(2026, 9, 18))
        finally:
            conn.close()


class TimelineCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "kpop.db"
        conn = build_test_database(self.db_path)
        conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_writes_valid_puzzle(self):
        out_file = self.temp_path / "puzzle_out.json"
        code = timeline_cli.main([
            "--database", str(self.db_path),
            "--output", str(out_file),
            "--date", "2026-09-18",
        ])
        self.assertEqual(code, 0)
        payload = json.loads(out_file.read_text(encoding="utf-8"))
        self.assertEqual(payload["reference_date"], "2026-09-18")
        validate_timeline_puzzle(payload)

    def test_cli_missing_database_returns_error(self):
        code = timeline_cli.main([
            "--database", str(self.temp_path / "missing.db"),
        ])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
