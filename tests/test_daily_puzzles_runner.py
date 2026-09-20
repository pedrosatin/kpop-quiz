"""Unit tests for the unified daily puzzles runner and CLI."""

from __future__ import annotations

import json
import sqlite3
import string
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import daily_puzzles_cli
from kpop_scraping.connections_schema import validate_connections_puzzle
from kpop_scraping.daily_puzzles_runner import (
    generate_daily_puzzles,
    get_reference_date,
    publish_daily_puzzles,
    run_daily_puzzles,
)
from kpop_scraping.grid_schema import validate_intersection_grid
from kpop_scraping.name_guess_schema import validate_name_guess_puzzle
from kpop_scraping.quiz_schema import validate_session
from kpop_scraping.timeline_schema import validate_timeline_puzzle
from kpop_scraping.web_publish import verify_artifacts
from kpop_scraping.word_search_schema import validate_word_search_puzzle


def build_test_database(db_path: Path) -> sqlite3.Connection:
    """Create a populated SQLite database that satisfies all 6 games."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE entities (
            id INTEGER PRIMARY KEY,
            wikidata_id TEXT NOT NULL UNIQUE,
            entity_type TEXT NOT NULL,
            canonical_name TEXT NOT NULL
        );
        CREATE TABLE entity_aliases (
            entity_id INTEGER,
            language TEXT,
            name TEXT,
            alias_type TEXT
        );
        CREATE TABLE facts (
            id INTEGER PRIMARY KEY,
            statement_id TEXT NOT NULL UNIQUE,
            subject_entity_id INTEGER NOT NULL,
            predicate TEXT NOT NULL,
            property_id TEXT,
            rank TEXT,
            value_wikidata_id TEXT,
            value_entity_id INTEGER,
            value_time TEXT,
            value_precision INTEGER,
            valid_from TEXT,
            valid_from_precision INTEGER,
            valid_to TEXT,
            valid_to_precision INTEGER,
            qualifiers_json TEXT,
            references_json TEXT,
            status TEXT NOT NULL,
            status_reason TEXT,
            quality_flags_json TEXT,
            extractor_version TEXT
        );
        CREATE TABLE wikidata_entity_snapshots (
            id INTEGER PRIMARY KEY,
            wikidata_id TEXT,
            external_revision_id INTEGER
        );
        CREATE TABLE source_pages (
            id INTEGER PRIMARY KEY,
            provider TEXT,
            language TEXT,
            external_page_id INTEGER
        );
        CREATE TABLE source_revisions (
            id INTEGER PRIMARY KEY,
            source_page_id INTEGER,
            external_revision_id INTEGER
        );
        CREATE TABLE fact_evidence (
            fact_id INTEGER,
            evidence_type TEXT,
            source_key TEXT,
            locator TEXT,
            reference_hash TEXT,
            snippet TEXT,
            wikidata_snapshot_id INTEGER,
            source_revision_id INTEGER
        );
        """
    )
    conn.execute("INSERT INTO wikidata_entity_snapshots VALUES (1, 'QSOURCE', 1001)")

    labels = [
        ("Q483238", "organization", "JYP Entertainment"),
        ("Q483957", "organization", "SM Entertainment"),
        ("Q483471", "organization", "YG Entertainment"),
        ("Q106399432", "organization", "HYBE"),
    ]
    entity_ids: dict[str, int] = {}
    for qid, etype, cname in labels:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
            (qid, etype, cname),
        )
        entity_ids[qid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, cname),
        )

    group_labels: dict[int, str] = {
        101: "Q483238", 102: "Q483238", 103: "Q483238", 104: "Q483238", 105: "Q483238",
        106: "Q483957", 107: "Q483957", 108: "Q483957", 109: "Q483957", 110: "Q483957",
        111: "Q483471", 112: "Q483471", 113: "Q483471", 114: "Q483471", 115: "Q483471",
        116: "Q106399432", 117: "Q106399432", 118: "Q106399432", 119: "Q106399432", 120: "Q106399432",
    }
    years: dict[int, int] = {
        101: 2004, 102: 2012, 103: 2015, 104: 2021, 105: 2023,
        106: 2007, 107: 2014, 108: 2016, 109: 2022, 110: 2024,
        111: 2006, 112: 2013, 113: 2017, 114: 2020, 115: 2023,
        116: 2009, 117: 2015, 118: 2018, 119: 2021, 120: 2024,
    }
    member_counts: dict[int, int] = {
        101: 4, 102: 5, 103: 7, 104: 9, 105: 6,
        106: 4, 107: 5, 108: 7, 109: 9, 110: 6,
        111: 4, 112: 5, 113: 7, 114: 9, 115: 6,
        116: 4, 117: 5, 118: 7, 119: 9, 120: 6,
    }
    letters = string.ascii_uppercase
    for idx, num in enumerate(range(101, 121)):
        qid = f"Q{num}"
        cname = f"Group{letters[idx]}"
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'group', ?)",
            (qid, cname),
        )
        entity_ids[qid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, cname),
        )

        lbl_qid = group_labels[num]
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'record_label', 'P264', 'normal', ?, ?, 'accepted', '[]')
            """,
            (f"stmt-lbl-{num}", cur.lastrowid, lbl_qid, entity_ids[lbl_qid]),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P264/ref', 'ref1', 1)
            """,
            (cur_f.lastrowid,),
        )

        cur_y = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'formed_on', 'P571', 'normal', ?, 9, 'accepted', '[]')
            """,
            (f"stmt-year-{num}", cur.lastrowid, f"{years[num]:04d}"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P571/ref', 'ref1', 1)
            """,
            (cur_y.lastrowid,),
        )

        for m in range(member_counts[num]):
            mqid = f"QP_{num}_{m}"
            mcname = f"Member {letters[idx]} {m}"
            cur_m = conn.execute(
                "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
                (mqid, mcname),
            )
            conn.execute(
                "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
                (cur_m.lastrowid, mcname),
            )
            conn.execute(
                "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
                (cur_m.lastrowid, mcname),
            )
            cur_mf = conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    value_wikidata_id, value_entity_id, status, quality_flags_json
                ) VALUES (?, ?, 'has_member', 'P527', 'normal', ?, ?, 'accepted', '[]')
                """,
                (f"stmt-mem-{num}-{m}", cur.lastrowid, mqid, cur_m.lastrowid),
            )
            conn.execute(
                """
                INSERT INTO fact_evidence(
                    fact_id, evidence_type, source_key, locator, reference_hash,
                    wikidata_snapshot_id
                ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P527/ref', 'ref1', 1)
                """,
                (cur_mf.lastrowid,),
            )

    for i in range(1, 10):
        qid = f"QR{i}"
        cname = f"Release {i}"
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'album', ?)",
            (qid, cname),
        )
        rel_id = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (rel_id, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (rel_id, cname),
        )
        group_qid = f"Q{100 + i}"
        group_cur = conn.execute(
            "SELECT id FROM entities WHERE wikidata_id = ?", (group_qid,)
        ).fetchone()
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'performed_by', 'P175', 'normal', ?, ?, 'accepted', '[]')
            """,
            (f"rel-perf-{i}", rel_id, group_qid, group_cur["id"]),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P175/ref', 'ref1', 1)
            """,
            (cur_f.lastrowid,),
        )
        cur_y = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'released_on', 'P577', 'normal', ?, 11, 'accepted', '[]')
            """,
            (f"rel-year-{i}", rel_id, f"201{i}-05-0{i}"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'domain:example.com', 'claims/P577/ref', 'ref1', 1)
            """,
            (cur_y.lastrowid,),
        )

    conn.commit()
    return conn


class DailyPuzzlesRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "kpop.db"
        conn = build_test_database(self.db_path)
        conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_get_reference_date(self):
        # Default (None) returns ISO date format YYYY-MM-DD
        default_date = get_reference_date()
        self.assertRegex(default_date, r"^\d{4}-\d{2}-\d{2}$")

        # String input
        self.assertEqual(get_reference_date("2026-09-18"), "2026-09-18")

        # Date object input
        self.assertEqual(get_reference_date(date(2026, 9, 18)), "2026-09-18")

        # Invalid string raises ValueError
        with self.assertRaises(ValueError):
            get_reference_date("2026-9-18")
        with self.assertRaises(ValueError):
            get_reference_date("not-a-date")

    def test_full_generation_all_six_games(self):
        output_dir = self.temp_path / "public_data"
        result = run_daily_puzzles(
            database=self.db_path,
            output_dir=output_dir,
            reference_date="2026-09-18",
            dry_run=False,
        )

        self.assertFalse(result["dry_run"])
        self.assertEqual(result["reference_date"], "2026-09-18")

        # Required daily puzzle files
        required_files = [
            "manifest-v2.json",
            "grid.daily.json",
            "connections.daily.json",
            "name-guess.daily.json",
            "word-search.daily.json",
            "timeline.daily.json",
            "session.pt-BR.json",
            "session.en.json",
        ]
        for fname in required_files:
            file_path = output_dir / fname
            self.assertTrue(file_path.is_file(), f"Expected file {fname} to exist")

        # Schema validation for all 6 games
        grid_payload = json.loads((output_dir / "grid.daily.json").read_text(encoding="utf-8"))
        validate_intersection_grid(grid_payload)
        self.assertEqual(grid_payload["reference_date"], "2026-09-18")

        conn_payload = json.loads((output_dir / "connections.daily.json").read_text(encoding="utf-8"))
        validate_connections_puzzle(conn_payload)
        self.assertEqual(conn_payload["reference_date"], "2026-09-18")

        guess_payload = json.loads((output_dir / "name-guess.daily.json").read_text(encoding="utf-8"))
        validate_name_guess_puzzle(guess_payload)
        self.assertEqual(guess_payload["reference_date"], "2026-09-18")

        ws_payload = json.loads((output_dir / "word-search.daily.json").read_text(encoding="utf-8"))
        validate_word_search_puzzle(ws_payload)
        self.assertEqual(ws_payload["reference_date"], "2026-09-18")

        timeline_payload = json.loads((output_dir / "timeline.daily.json").read_text(encoding="utf-8"))
        validate_timeline_puzzle(timeline_payload)
        self.assertEqual(timeline_payload["reference_date"], "2026-09-18")
        self.assertEqual(result["timeline_id"], timeline_payload["puzzle_id"])

        pt_session = json.loads((output_dir / "session.pt-BR.json").read_text(encoding="utf-8"))
        validate_session(pt_session)
        self.assertEqual(pt_session["config"]["language"], "pt-BR")

        en_session = json.loads((output_dir / "session.en.json").read_text(encoding="utf-8"))
        validate_session(en_session)
        self.assertEqual(en_session["config"]["language"], "en")

        # Complete verify_artifacts call passes
        verify_artifacts(
            output_dir,
            require_grid=True,
            require_connections=True,
            require_name_guess=True,
            require_word_search=True,
            require_timeline=True,
        )

    def test_dry_run_does_not_modify_output_dir(self):
        output_dir = self.temp_path / "empty_output"
        sentinel_file = output_dir / "keep_me.txt"
        output_dir.mkdir(parents=True, exist_ok=True)
        sentinel_file.write_text("untouched")

        result = run_daily_puzzles(
            database=self.db_path,
            output_dir=output_dir,
            reference_date="2026-09-18",
            dry_run=True,
        )

        self.assertTrue(result["dry_run"])
        # Production directory must not have puzzle files
        self.assertFalse((output_dir / "grid.daily.json").exists())
        self.assertFalse((output_dir / "connections.daily.json").exists())
        self.assertFalse((output_dir / "name-guess.daily.json").exists())
        self.assertFalse((output_dir / "word-search.daily.json").exists())
        self.assertFalse((output_dir / "timeline.daily.json").exists())
        self.assertFalse((output_dir / "manifest-v2.json").exists())
        # Sentinel file remains intact
        self.assertEqual(sentinel_file.read_text(), "untouched")

    def test_custom_dates_and_deterministic_seeds(self):
        out_dir_1 = self.temp_path / "run_1"
        out_dir_2 = self.temp_path / "run_2"
        out_dir_diff_date = self.temp_path / "run_diff_date"

        res_1 = run_daily_puzzles(self.db_path, out_dir_1, reference_date="2026-09-18")
        res_2 = run_daily_puzzles(self.db_path, out_dir_2, reference_date="2026-09-18")
        res_diff = run_daily_puzzles(self.db_path, out_dir_diff_date, reference_date="2026-09-19")

        # Determinism for same date
        self.assertEqual(res_1["grid_id"], res_2["grid_id"])
        self.assertEqual(res_1["connections_id"], res_2["connections_id"])
        self.assertEqual(res_1["name_guess_id"], res_2["name_guess_id"])
        self.assertEqual(res_1["word_search_id"], res_2["word_search_id"])
        self.assertEqual(res_1["timeline_id"], res_2["timeline_id"])

        # Identical files for same date
        for filename in (
            "grid.daily.json",
            "connections.daily.json",
            "name-guess.daily.json",
            "word-search.daily.json",
            "timeline.daily.json",
        ):
            content_1 = (out_dir_1 / filename).read_bytes()
            content_2 = (out_dir_2 / filename).read_bytes()
            self.assertEqual(content_1, content_2, f"Expected {filename} to be byte-identical")

        # Different date produces different reference_date
        self.assertEqual(res_diff["reference_date"], "2026-09-19")

    def test_verify_mode(self):
        output_dir = self.temp_path / "verify_target"
        run_daily_puzzles(self.db_path, output_dir, reference_date="2026-09-18")

        # verify_only succeeds on valid directory
        verify_res = run_daily_puzzles(output_dir=output_dir, verify_only=True)
        self.assertEqual(verify_res["status"], "verified")

        # Corrupting an artifact causes verify_only to raise ValueError
        grid_file = output_dir / "grid.daily.json"
        grid_data = json.loads(grid_file.read_text(encoding="utf-8"))
        grid_data["dimensions"]["rows"] = 99  # Invalid schema
        grid_file.write_text(json.dumps(grid_data), encoding="utf-8")

        with self.assertRaises(ValueError):
            run_daily_puzzles(output_dir=output_dir, verify_only=True)

    def test_missing_database_raises_error(self):
        non_existent_db = self.temp_path / "does_not_exist.db"
        with self.assertRaises(FileNotFoundError):
            run_daily_puzzles(database=non_existent_db, output_dir=self.temp_path / "out")

    def test_cli_execution_success_and_verify(self):
        out_dir = self.temp_path / "cli_out"

        # 1. Run generation via CLI
        code = daily_puzzles_cli.main([
            "--database", str(self.db_path),
            "--output-dir", str(out_dir),
            "--date", "2026-09-18",
        ])
        self.assertEqual(code, 0)
        self.assertTrue((out_dir / "grid.daily.json").is_file())
        self.assertTrue((out_dir / "timeline.daily.json").is_file())

        # 2. Run verify via CLI
        verify_code = daily_puzzles_cli.main([
            "--output-dir", str(out_dir),
            "--verify",
        ])
        self.assertEqual(verify_code, 0)

        # 3. Dry-run via CLI
        dry_out = self.temp_path / "cli_dry_out"
        dry_code = daily_puzzles_cli.main([
            "--database", str(self.db_path),
            "--output-dir", str(dry_out),
            "--date", "2026-09-18",
            "--dry-run",
        ])
        self.assertEqual(dry_code, 0)
        self.assertFalse(dry_out.exists())

        # 4. Database missing returns 1
        missing_code = daily_puzzles_cli.main([
            "--database", str(self.temp_path / "no_such.db"),
            "--output-dir", str(out_dir),
        ])
        self.assertEqual(missing_code, 1)


if __name__ == "__main__":
    unittest.main()
