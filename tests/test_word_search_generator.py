"""Unit tests for deterministic word search generator and CLI."""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.word_search_cli import main as cli_main
from kpop_scraping.word_search_generator import (
    DIRECTIONS,
    extract_viable_themes,
    find_word_occurrences,
    generate_word_search_puzzle,
    normalize_word,
)
from kpop_scraping.word_search_schema import (
    extract_word_coordinates,
    validate_word_search_clues,
    validate_word_search_puzzle,
)


def build_word_search_test_database() -> sqlite3.Connection:
    """Create an in-memory SQLite database with audited test entities, facts, and evidence."""
    conn = sqlite3.connect(":memory:")
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

    # Record labels
    labels = [
        ("Q483238", "organization", "JYP Entertainment"),
        ("Q483957", "organization", "SM Entertainment"),
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

    # JYP Groups (6 groups)
    jyp_groups = [
        ("Q21480414", "TWICE", 2015),
        ("Q60738096", "ITZY", 2019),
        ("Q46134670", "Stray Kids", 2017),
        ("Q110689366", "NMIXX", 2022),
        ("Q20863870", "Day6", 2015),
        ("Q56278850", "Boy Story", 2018),
    ]
    for qid, cname, year in jyp_groups:
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
        # record_label fact
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'record_label', 'P264', 'normal', 'Q483238', ?, 'accepted', '[]')
            """,
            (f"label-{qid}", cur.lastrowid, entity_ids["Q483238"]),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P264/hash1', 'ref1', 1)
            """,
            (cur_f.lastrowid,),
        )
        # formed_on fact
        cur_y = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'formed_on', 'P571', 'normal', ?, 9, 'accepted', '[]')
            """,
            (f"formed-{qid}", cur.lastrowid, f"+{year}-01-01T00:00:00Z"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P571/hash1', 'ref1', 1)
            """,
            (cur_y.lastrowid,),
        )

    # SM Groups (6 groups)
    sm_groups = [
        ("Q100877964", "aespa", 2020),
        ("Q17425336", "Red Velvet", 2014),
        ("Q26983", "SHINee", 2008),
        ("Q494887", "EXO", 2012),
        ("Q23765422", "NCT", 2016),
        ("Q239797", "Super Junior", 2005),
    ]
    for qid, cname, year in sm_groups:
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
        # record_label fact
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'record_label', 'P264', 'normal', 'Q483957', ?, 'accepted', '[]')
            """,
            (f"label-{qid}", cur.lastrowid, entity_ids["Q483957"]),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P264/hash1', 'ref1', 1)
            """,
            (cur_f.lastrowid,),
        )
        # formed_on fact
        cur_y = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'formed_on', 'P571', 'normal', ?, 9, 'accepted', '[]')
            """,
            (f"formed-{qid}", cur.lastrowid, f"+{year}-01-01T00:00:00Z"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P571/hash1', 'ref1', 1)
            """,
            (cur_y.lastrowid,),
        )

    # TWICE members (9 members)
    twice_members = [
        ("Q21040333", "Nayeon"),
        ("Q21040344", "Jeongyeon"),
        ("Q21040355", "Momo"),
        ("Q21040366", "Sana"),
        ("Q21040377", "Jihyo"),
        ("Q21040388", "Mina"),
        ("Q21040399", "Dahyun"),
        ("Q21040400", "Chaeyoung"),
        ("Q21040411", "Tzuyu"),
    ]
    twice_entity_id = entity_ids["Q21480414"]
    for pqid, pname in twice_members:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
            (pqid, pname),
        )
        entity_ids[pqid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, pname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, pname),
        )
        cur_m = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'has_member', 'P527', 'normal', ?, ?, 'accepted', '[]')
            """,
            (f"twice-member-{pqid}", twice_entity_id, pqid, cur.lastrowid),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P527/hash1', 'ref1', 1)
            """,
            (cur_m.lastrowid,),
        )

    # Red Velvet members (5 members)
    rv_members = [
        ("Q12605358", "Irene"),
        ("Q15934116", "Seulgi"),
        ("Q17478642", "Wendy"),
        ("Q17484113", "Joy"),
        ("Q19940498", "Yeri"),
    ]
    rv_entity_id = entity_ids["Q17425336"]
    for pqid, pname in rv_members:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'person', ?)",
            (pqid, pname),
        )
        entity_ids[pqid] = cur.lastrowid
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (cur.lastrowid, pname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (cur.lastrowid, pname),
        )
        cur_m = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'has_member', 'P527', 'normal', ?, ?, 'accepted', '[]')
            """,
            (f"rv-member-{pqid}", rv_entity_id, pqid, cur.lastrowid),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(
                fact_id, evidence_type, source_key, locator, reference_hash,
                wikidata_snapshot_id
            ) VALUES (?, 'wikidata_reference', 'wikidata', 'P527/hash1', 'ref1', 1)
            """,
            (cur_m.lastrowid,),
        )

    conn.commit()
    return conn


class TestWordNormalization(unittest.TestCase):
    def test_normalize_plain_words(self) -> None:
        self.assertEqual(normalize_word("TWICE"), "TWICE")
        self.assertEqual(normalize_word("aespa"), "AESPA")
        self.assertEqual(normalize_word("STAYC"), "STAYC")
        self.assertEqual(normalize_word("Kara"), "KARA")

    def test_normalize_punctuation_and_spaces(self) -> None:
        self.assertEqual(normalize_word("(G)I-DLE"), "GIDLE")
        self.assertEqual(normalize_word("LE SSERAFIM"), "LESSERAFIM")
        self.assertEqual(normalize_word("BLACKPINK"), "BLACKPINK")
        self.assertEqual(normalize_word("Girls' Generation"), "GIRLSGENERATION")

    def test_normalize_accents_and_diacritics(self) -> None:
        self.assertEqual(normalize_word("BÉBÉ"), "BEBE")
        self.assertEqual(normalize_word("Sérgio"), "SERGIO")
        self.assertEqual(normalize_word("Chloë"), "CHLOE")

    def test_normalize_numbers_and_non_alpha(self) -> None:
        self.assertEqual(normalize_word("2NE1"), "NE")
        self.assertEqual(normalize_word("Day6"), "DAY")
        self.assertEqual(normalize_word("1TYM"), "TYM")
        self.assertEqual(normalize_word("123"), "")


class TestWordSearchGenerator(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = build_word_search_test_database()

    def tearDown(self) -> None:
        self.conn.close()

    def test_generate_puzzle_conforms_to_schema(self) -> None:
        puzzle = generate_word_search_puzzle(
            self.conn,
            seed="test-seed-1",
            reference_date=date(2026, 9, 18),
        )
        validate_word_search_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-word-search-puzzle-v1")
        self.assertEqual(puzzle["dimensions"], {"rows": 12, "cols": 12})
        self.assertEqual(len(puzzle["grid"]), 12)
        self.assertEqual(len(puzzle["grid"][0]), 12)
        self.assertGreaterEqual(len(puzzle["words"]), 5)
        self.assertLessEqual(len(puzzle["words"]), 10)

        for word_entry in puzzle["words"]:
            coords = extract_word_coordinates(
                word_entry["start_row"],
                word_entry["start_col"],
                word_entry["end_row"],
                word_entry["end_col"],
            )
            self.assertEqual(len(coords), len(word_entry["word"]))
            grid_chars = "".join(puzzle["grid"][r][c] for r, c in coords)
            self.assertEqual(grid_chars, word_entry["word"])
            self.assertGreaterEqual(len(word_entry["evidence"]), 1)

    def test_configurable_dimensions(self) -> None:
        for r, c in [(8, 8), (10, 10), (14, 14), (16, 16)]:
            puzzle = generate_word_search_puzzle(
                self.conn,
                seed="dim-seed",
                reference_date=date(2026, 9, 18),
                rows=r,
                cols=c,
            )
            validate_word_search_puzzle(puzzle)
            self.assertEqual(puzzle["dimensions"], {"rows": r, "cols": c})
            self.assertEqual(len(puzzle["grid"]), r)
            self.assertEqual(len(puzzle["grid"][0]), c)

    def test_invalid_dimensions_raise_value_error(self) -> None:
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(self.conn, seed="err", rows=7, cols=12)
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(self.conn, seed="err", rows=17, cols=12)
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(self.conn, seed="err", rows=12, cols=7)
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(self.conn, seed="err", rows=12, cols=17)

    def test_determinism_same_seed_and_date(self) -> None:
        p1 = generate_word_search_puzzle(
            self.conn, seed="seed-det-1", reference_date=date(2026, 9, 18)
        )
        p2 = generate_word_search_puzzle(
            self.conn, seed="seed-det-1", reference_date=date(2026, 9, 18)
        )
        self.assertEqual(p1["puzzle_id"], p2["puzzle_id"])
        self.assertEqual(p1["grid"], p2["grid"])
        self.assertEqual(p1["words"], p2["words"])
        self.assertEqual(p1["theme"], p2["theme"])

    def test_seed_variation_produces_distinct_puzzles(self) -> None:
        p1 = generate_word_search_puzzle(
            self.conn, seed="seed-alpha", reference_date=date(2026, 9, 18)
        )
        p2 = generate_word_search_puzzle(
            self.conn, seed="seed-beta", reference_date=date(2026, 9, 18)
        )
        self.assertNotEqual(p1["puzzle_id"], p2["puzzle_id"])

    def test_theme_filtering(self) -> None:
        # Filter by JYP label
        p_jyp = generate_word_search_puzzle(
            self.conn,
            seed="theme-jyp",
            reference_date=date(2026, 9, 18),
            theme_filter="label_jyp",
        )
        self.assertIn("JYP", p_jyp["theme"]["en"])

        # Filter by SM label
        p_sm = generate_word_search_puzzle(
            self.conn,
            seed="theme-sm",
            reference_date=date(2026, 9, 18),
            theme_filter="SM Entertainment",
        )
        self.assertIn("SM Entertainment", p_sm["theme"]["en"])

        # Filter by TWICE members
        p_twice = generate_word_search_puzzle(
            self.conn,
            seed="theme-twice",
            reference_date=date(2026, 9, 18),
            theme_filter="TWICE",
        )
        self.assertIn("TWICE", p_twice["theme"]["en"])

        # Unknown theme filter
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(
                self.conn,
                seed="theme-err",
                reference_date=date(2026, 9, 18),
                theme_filter="nonexistent_theme",
            )

    def test_eight_linear_axes_coverage(self) -> None:
        directions_found: set[tuple[int, int]] = set()
        for s in range(20):
            puzzle = generate_word_search_puzzle(
                self.conn,
                seed=f"direction-coverage-{s}",
                reference_date=date(2026, 9, 18),
            )
            for w in puzzle["words"]:
                dr = w["end_row"] - w["start_row"]
                dc = w["end_col"] - w["start_col"]
                step_r = 0 if dr == 0 else (1 if dr > 0 else -1)
                step_c = 0 if dc == 0 else (1 if dc > 0 else -1)
                directions_found.add((step_r, step_c))
            if len(directions_found) == 8:
                break

        self.assertEqual(
            directions_found,
            set(DIRECTIONS),
            f"All 8 linear axes must be covered, missing: {set(DIRECTIONS) - directions_found}",
        )

    def test_filling_and_absence_of_spurious_target_words(self) -> None:
        puzzle = generate_word_search_puzzle(
            self.conn,
            seed="uniqueness-check-seed",
            reference_date=date(2026, 9, 18),
        )
        grid = puzzle["grid"]

        # Ensure all grid cells are single uppercase ASCII
        for r in grid:
            for cell in r:
                self.assertTrue(cell.isalpha() and cell.isupper() and len(cell) == 1)

        # Check each declared word occurs exactly once in the grid (or forward and backward for palindromes)
        for w in puzzle["words"]:
            target_word = w["word"]
            occurrences = find_word_occurrences(grid, target_word)
            expected = (w["start_row"], w["start_col"], w["end_row"], w["end_col"])
            if target_word == target_word[::-1]:
                reverse_expected = (w["end_row"], w["end_col"], w["start_row"], w["start_col"])
                self.assertEqual(set(occurrences), {expected, reverse_expected})
                self.assertEqual(len(occurrences), 2)
            else:
                self.assertEqual(
                    occurrences,
                    [expected],
                    f"Word {target_word} must occur exactly once at {expected}, got {occurrences}",
                )

    def test_empty_database_raises_value_error(self) -> None:
        empty_conn = sqlite3.connect(":memory:")
        empty_conn.executescript(
            """
            CREATE TABLE entities (id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT);
            CREATE TABLE entity_aliases (entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts (id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER, predicate TEXT, property_id TEXT, rank TEXT, value_wikidata_id TEXT, value_entity_id INTEGER, value_time TEXT, value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER, valid_to TEXT, valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT, status TEXT, status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT);
            CREATE TABLE wikidata_entity_snapshots (id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_pages (id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER);
            CREATE TABLE source_revisions (id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE fact_evidence (fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT, reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
            """
        )
        with self.assertRaises(ValueError):
            generate_word_search_puzzle(empty_conn, seed="empty-db")
        empty_conn.close()


class TestWordSearchCLI(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"

        # Populate SQLite database file
        disk_conn = sqlite3.connect(str(self.db_path))
        mem_conn = build_word_search_test_database()
        mem_conn.backup(disk_conn)
        disk_conn.close()
        mem_conn.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_nonexistent_database_returns_error(self) -> None:
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            ret = cli_main(["--database", "/tmp/nonexistent_db_12345.db"])
        self.assertEqual(ret, 1)
        self.assertIn("Database does not exist", stderr_buf.getvalue())

    def test_stdout_generation_and_verify(self) -> None:
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(
                [
                    "--database",
                    str(self.db_path),
                    "--seed",
                    "cli-seed-stdout",
                    "--date",
                    "2026-09-18",
                    "--verify",
                ]
            )
        self.assertEqual(ret, 0)
        output_text = stdout_buf.getvalue()
        payload = json.loads(output_text)
        validate_word_search_puzzle(payload)
        self.assertEqual(payload["reference_date"], "2026-09-18")

    def test_file_output_atomic_write(self) -> None:
        output_file = Path(self.temp_dir.name) / "output_puzzle.json"
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(
                [
                    "--database",
                    str(self.db_path),
                    "--output",
                    str(output_file),
                    "--seed",
                    "cli-seed-file",
                    "--rows",
                    "10",
                    "--cols",
                    "10",
                    "--verify",
                ]
            )
        self.assertEqual(ret, 0)
        self.assertTrue(output_file.is_file())
        with open(output_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        validate_word_search_puzzle(payload)
        self.assertEqual(payload["dimensions"], {"rows": 10, "cols": 10})

    def test_cli_theme_filter(self) -> None:
        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf):
            ret = cli_main(
                [
                    "--database",
                    str(self.db_path),
                    "--theme",
                    "TWICE",
                    "--verify",
                ]
            )
        self.assertEqual(ret, 0)
        payload = json.loads(stdout_buf.getvalue())
        self.assertIn("TWICE", payload["theme"]["en"])


class TestWordSearchRealDatabase(unittest.TestCase):
    def test_real_database_daily_generation(self) -> None:
        real_db = Path("data/kpop.db")
        if not real_db.is_file():
            self.skipTest("data/kpop.db not available")

        conn = sqlite3.connect(str(real_db))
        try:
            puzzles = [
                generate_word_search_puzzle(
                    conn,
                    seed="kpop-word-search-daily-2026-09-18",
                    reference_date=date(2026, 9, 18),
                )
                for _ in range(2)
            ]
        finally:
            conn.close()

        puzzle = puzzles[0]
        validate_word_search_puzzle(puzzle)
        validate_word_search_clues(puzzle)
        # The local database changes with every collection run, so the test
        # pins determinism instead of a fixed puzzle_id.
        self.assertEqual(puzzle["puzzle_id"], puzzles[1]["puzzle_id"])
        self.assertEqual(puzzle["reference_date"], "2026-09-18")

    def test_candidate_label_fallback_when_normalized_differs(self) -> None:
        from kpop_scraping.quiz_models import Entity, Evidence, Fact
        from kpop_scraping.word_search_generator import _build_candidate

        ent = Entity(
            wikidata_id="Q494222",
            entity_type="person",
            canonical_name="Lee Sungmin",
            names={"pt": "Sungmin", "en": "Lee Sungmin"},
            aliases=(),
        )
        ev = Evidence(
            fact_base_id="Q1$1",
            source_key="test",
            locator="test",
            source_url="https://example.com/test",
            revision_id=1,
        )
        fact = Fact(
            statement_id="s1",
            subject=ent,
            predicate="has_member",
            value_entity=None,
            value_time=None,
            value_precision=None,
            valid_from=None,
            valid_from_precision=None,
            valid_to=None,
            valid_to_precision=None,
            flags=(),
            evidence=(ev,),
        )
        cand = _build_candidate(ent, [fact], min_dim=12)
        self.assertIsNotNone(cand)
        assert cand is not None
        self.assertEqual(cand.word, "LEESUNGMIN")
        self.assertEqual(cand.labels["pt-BR"], "Lee Sungmin")
        self.assertEqual(cand.labels["en"], "Lee Sungmin")

    def test_short_canonical_names_under_three_letters_are_discarded(self) -> None:
        from kpop_scraping.quiz_models import Entity, Evidence, Fact
        from kpop_scraping.word_search_generator import _build_candidate, _display_name

        ev = Evidence("Q1$1", "test", "test", "https://example.com/test", 1)

        # I.N (Stray Kids) normalizes to "IN" (2 letters). Even with longer aliases,
        # it must be discarded to prevent accidental grid collisions and label mismatch.
        in_entity = Entity(
            wikidata_id="Q59831589",
            entity_type="person",
            canonical_name="I.N",
            names={"pt": "I.N", "en": "I.N"},
            aliases=("Yang Jeong-in", "Jeongin"),
        )
        self.assertIsNone(_display_name(in_entity, min_dim=12))
        fact_in = Fact("s_in", in_entity, "has_member", None, None, None, None, None, None, None, (), (ev,))
        self.assertIsNone(_build_candidate(in_entity, [fact_in], min_dim=12))

        # V (BTS) normalizes to "V" (1 letter). Must also be discarded.
        v_entity = Entity(
            wikidata_id="Q13856101",
            entity_type="person",
            canonical_name="V",
            names={"pt": "V", "en": "V"},
            aliases=("Kim Tae-hyung", "Taehyung"),
        )
        self.assertIsNone(_display_name(v_entity, min_dim=12))
        fact_v = Fact("s_v", v_entity, "has_member", None, None, None, None, None, None, None, (), (ev,))
        self.assertIsNone(_build_candidate(v_entity, [fact_v], min_dim=12))

    def test_long_canonical_names_fall_back_to_alias_when_fitting(self) -> None:
        from kpop_scraping.quiz_models import Entity
        from kpop_scraping.word_search_generator import _display_name

        # A name with 18 letters exceeds a 12x12 grid, but has an alias of 7 letters.
        long_entity = Entity(
            wikidata_id="Q999999",
            entity_type="person",
            canonical_name="Super Long Idol Name Here",
            names={"pt": "Super Long Idol Name Here", "en": "Super Long Idol Name Here"},
            aliases=("Shortie",),
        )
        display = _display_name(long_entity, min_dim=12)
        self.assertIsNotNone(display)
        assert display is not None
        name, word = display
        self.assertEqual(name, "Shortie")
        self.assertEqual(word, "SHORTIE")


if __name__ == "__main__":
    unittest.main()
