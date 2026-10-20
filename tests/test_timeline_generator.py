"""Unit tests for the deterministic timeline puzzle generator and CLI."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from kpop_scraping import timeline_cli
from kpop_scraping.timeline_generator import (
    format_display_date,
    generate_timeline_puzzle,
)
from kpop_scraping.timeline_schema import (
    TIMELINE_MIN_EVENT_GAP_DAYS,
    TIMELINE_SCHEMA_VERSION,
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


RELEASE_DATES = (
    "2003-04-10", "2006-08-21", "2009-01", "2011-06-30", "2013-11-05",
    "2016", "2018-03-14", "2020-09-01", "2022-05-27", "2024-12-02",
)


def add_release(
    conn: sqlite3.Connection,
    qid: str,
    name: str,
    released_on: str | list[str],
    performer_qid: str | None = None,
    entity_type: str = "album",
) -> None:
    """Insert a release entity with accepted, evidenced released_on/performed_by facts."""
    cur = conn.execute(
        "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
        (qid, entity_type, name),
    )
    release_id = cur.lastrowid
    for language in ("en", "pt"):
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, ?, ?, 'label')",
            (release_id, language, name),
        )
    dates = [released_on] if isinstance(released_on, str) else released_on
    precision = {4: 9, 7: 10, 10: 11}
    rows = [
        (f"stmt-released-{qid}-{index}", "released_on", "P577", None, None, value, precision[len(value)])
        for index, value in enumerate(dates)
    ]
    if performer_qid is not None:
        performer_id = conn.execute(
            "SELECT id FROM entities WHERE wikidata_id = ?", (performer_qid,)
        ).fetchone()[0]
        rows.append(
            (f"stmt-performer-{qid}", "performed_by", "P175", performer_qid, performer_id, None, None)
        )
    for statement_id, predicate, property_id, value_qid, value_id, value_time, value_precision in rows:
        fact = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, value_time, value_precision,
                status, quality_flags_json
            ) VALUES (?, ?, ?, ?, 'normal', ?, ?, ?, ?, 'accepted', '[]')
            """,
            (statement_id, release_id, predicate, property_id, value_qid, value_id, value_time, value_precision),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', ?, 'ref1', 1)
            """,
            (fact.lastrowid, f"claims/{property_id}/{statement_id}/ref"),
        )


def first_release_theme_date(conn: sqlite3.Connection) -> date:
    for day in range(1, 61):
        reference = date(2026, 10, 1) + timedelta(days=day)
        puzzle = generate_timeline_puzzle(conn, reference_date=reference)
        if puzzle["theme"]["en"] == "Releases":
            return reference
    raise AssertionError("no date in the window draws the release theme")


class TimelineReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "kpop.db"
        conn = build_test_database(self.db_path)
        try:
            for index, released_on in enumerate(RELEASE_DATES):
                performer = f"Q{101 + index}" if index % 2 == 0 else None
                add_release(conn, f"Q900{index}", f"Album {index}", released_on, performer)
            conn.commit()
        finally:
            conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _connect_readonly(self) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def _release_events(self) -> tuple[date, dict]:
        conn = self._connect_readonly()
        try:
            reference = first_release_theme_date(conn)
            return reference, generate_timeline_puzzle(conn, reference_date=reference)
        finally:
            conn.close()

    def test_release_theme_is_bilingual_and_valid(self):
        _reference, puzzle = self._release_events()
        validate_timeline_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], TIMELINE_SCHEMA_VERSION)
        self.assertEqual(puzzle["theme"], {"pt-BR": "Lançamentos", "en": "Releases"})
        self.assertTrue(all(ev["event_type"] == "release" for ev in puzzle["events"]))
        dates = [ev["date"] for ev in puzzle["events"]]
        self.assertEqual(dates, sorted(dates))
        self.assertTrue(set(dates) <= set(RELEASE_DATES))

    def test_release_label_names_performer_only_with_accepted_fact(self):
        _reference, puzzle = self._release_events()
        for ev in puzzle["events"]:
            index = int(ev["entity_id"].removeprefix("Q900"))
            name = f"Album {index}"
            locators = {item["locator"] for item in ev["evidence"]}
            self.assertEqual(ev["id"], f"timeline-release-Q900{index}")
            self.assertEqual(ev["entity_name"], name)
            self.assertIn(f"claims/P577/stmt-released-Q900{index}-0/ref", locators)
            if index % 2 == 0:
                group = f"Group{'ABCDEFGHIJ'[index]}"
                self.assertEqual(ev["title"]["pt-BR"], f"Lançamento de \u201c{name}\u201d ({group})")
                self.assertEqual(ev["title"]["en"], f"Release of \u201c{name}\u201d ({group})")
                self.assertEqual(ev["description"]["en"], f"Release of the album \u201c{name}\u201d by {group}.")
                self.assertIn(f"claims/P175/stmt-performer-Q900{index}/ref", locators)
            else:
                self.assertEqual(ev["title"]["pt-BR"], f"Lançamento de \u201c{name}\u201d")
                self.assertEqual(ev["description"]["pt-BR"], f"Lançamento do álbum \u201c{name}\u201d.")
                self.assertFalse(any("P175" in locator for locator in locators))

    def test_release_with_conflicting_dates_or_shared_title_is_skipped(self):
        conn = sqlite3.connect(str(self.db_path))
        try:
            add_release(conn, "Q9100", "Two Dates", ["2005-02-01", "2005-09-01"], "Q101")
            add_release(conn, "Q9101", "Same Title", "2007-03-03")
            add_release(conn, "Q9102", "Same Title", "2010-10-10")
            add_release(conn, "Q9103", "Same Title", "2012-02-02", "Q102")
            add_release(conn, "QR_FAKE", "No Qid", "2014-02-02")
            add_release(conn, "Q9104", "Too Old", "1975-05-05")
            conn.commit()
        finally:
            conn.close()

        conn = self._connect_readonly()
        try:
            from kpop_scraping.quiz_repository import _load_entities, _load_facts
            from kpop_scraping.timeline_generator import _build_release_candidates

            facts, _rejected = _load_facts(conn, _load_entities(conn))
            ids = {cand.entity_id for cand in _build_release_candidates(facts)}
        finally:
            conn.close()
        self.assertNotIn("Q9100", ids)
        self.assertNotIn("Q9101", ids)
        self.assertNotIn("Q9102", ids)
        # The performer sets this one apart from the two unattributed copies.
        self.assertIn("Q9103", ids)
        self.assertNotIn("QR_FAKE", ids)
        self.assertNotIn("Q9104", ids)
        self.assertEqual(ids - {"Q9103"}, {f"Q900{index}" for index in range(len(RELEASE_DATES))})

    def test_missing_release_pool_falls_back_to_existing_themes(self):
        reference, _puzzle = self._release_events()
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.execute("UPDATE facts SET status = 'rejected' WHERE predicate = 'released_on'")
            conn.commit()
        finally:
            conn.close()

        conn = self._connect_readonly()
        try:
            puzzle = generate_timeline_puzzle(conn, reference_date=reference)
        finally:
            conn.close()
        validate_timeline_puzzle(puzzle)
        self.assertNotEqual(puzzle["theme"]["en"], "Releases")
        self.assertFalse(any(ev["event_type"] == "release" for ev in puzzle["events"]))


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
