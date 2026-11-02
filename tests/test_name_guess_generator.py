"""Unit tests for name guess puzzle generator and CLI."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.name_guess_generator import generate_name_guess_puzzle
from kpop_scraping.name_guess_schema import validate_name_guess_puzzle
from kpop_scraping.quiz_utils import hash_payload


def build_name_guess_test_database() -> sqlite3.Connection:
    """Create an in-memory SQLite database populated with entities, facts, and evidence."""
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

    # Groups
    groups = [
        ("Q21480414", "group", "TWICE", 2015, "Q483238", 9),
        ("Q10000001", "group", "aespa", 2020, "Q483957", 4),
        ("Q10000002", "group", "STAYC", 2020, "Q483238", 6),
        ("Q10000003", "group", "LOONA", 2018, "Q483957", 12),
        ("Q10000004", "group", "ITZY", 2019, "Q483238", 5),
        ("Q10000005", "group", "KARA", 2007, "Q483957", 4),
        ("Q10000006", "group", "NewJeans", 2022, "Q483238", 5),
    ]

    fact_id_seq = 1
    for qid, etype, cname, year, label_qid, members_count in groups:
        cur = conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, ?, ?)",
            (qid, etype, cname),
        )
        e_id = cur.lastrowid
        entity_ids[qid] = e_id

        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')",
            (e_id, cname),
        )
        conn.execute(
            "INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')",
            (e_id, cname),
        )

        # Fact 1: formed_on
        stmt_formed = f"stmt-formed-{qid}"
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (?, ?, 'formed_on', 'P571', 'normal', ?, 9, 'accepted', '[]')
            """,
            (stmt_formed, e_id, f"{year}-01-01"),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(fact_id, evidence_type, source_key, locator, wikidata_snapshot_id)
            VALUES (?, 'claim', 'wikidata', ?, 1)
            """,
            (cur_f.lastrowid, f"claims/P571/{qid}"),
        )

        # Fact 2: record_label
        stmt_label = f"stmt-label-{qid}"
        cur_f = conn.execute(
            """
            INSERT INTO facts(
                statement_id, subject_entity_id, predicate, property_id, rank,
                value_wikidata_id, value_entity_id, status, quality_flags_json
            ) VALUES (?, ?, 'record_label', 'P264', 'normal', ?, ?, 'accepted', '[]')
            """,
            (stmt_label, e_id, label_qid, entity_ids[label_qid]),
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(fact_id, evidence_type, source_key, locator, wikidata_snapshot_id)
            VALUES (?, 'claim', 'wikidata', ?, 1)
            """,
            (cur_f.lastrowid, f"claims/P264/{qid}"),
        )

        # Fact 3: has_member (members_count facts)
        for m_idx in range(members_count):
            stmt_mem = f"stmt-mem-{qid}-{m_idx}"
            cur_f = conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    status, quality_flags_json
                ) VALUES (?, ?, 'has_member', 'P527', 'normal', 'accepted', '[]')
                """,
                (stmt_mem, e_id),
            )
            conn.execute(
                """
                INSERT INTO fact_evidence(fact_id, evidence_type, source_key, locator, wikidata_snapshot_id)
                VALUES (?, 'claim', 'wikidata', ?, 1)
                """,
                (cur_f.lastrowid, f"claims/P527/{qid}#{m_idx}"),
            )

    conn.commit()
    return conn


class TestNameGuessGenerator(unittest.TestCase):
    """Test deterministic generation of K-pop name guess puzzles."""

    def setUp(self):
        self.conn = build_name_guess_test_database()
        self.ref_date = date(2026, 9, 18)

    def tearDown(self):
        self.conn.close()

    def test_generate_puzzle_structure_and_validity(self):
        puzzle = generate_name_guess_puzzle(
            self.conn,
            seed="test-seed-1",
            reference_date=self.ref_date,
        )
        validate_name_guess_puzzle(puzzle)
        self.assertEqual(puzzle["schema_version"], "kpop-name-guess-puzzle-v1")
        self.assertEqual(puzzle["reference_date"], "2026-09-18")
        self.assertIn(puzzle["word_length"], (4, 5, 8))
        self.assertEqual(puzzle["max_attempts"], 6)

    def test_determinism_same_seed(self):
        puzzle1 = generate_name_guess_puzzle(
            self.conn,
            seed="seed-consistent",
            reference_date=self.ref_date,
        )
        puzzle2 = generate_name_guess_puzzle(
            self.conn,
            seed="seed-consistent",
            reference_date=self.ref_date,
        )
        self.assertEqual(puzzle1, puzzle2)
        self.assertEqual(puzzle1["puzzle_id"], puzzle2["puzzle_id"])
        self.assertEqual(
            puzzle1["target"]["canonical_name"], puzzle2["target"]["canonical_name"]
        )

    def test_determinism_different_seed(self):
        puzzle_a = generate_name_guess_puzzle(
            self.conn,
            seed="seed-alpha-123",
            reference_date=self.ref_date,
            word_length=5,
        )
        puzzle_b = generate_name_guess_puzzle(
            self.conn,
            seed="seed-beta-456",
            reference_date=self.ref_date,
            word_length=5,
        )
        # Seeds must produce distinct puzzle IDs and different targets
        self.assertNotEqual(puzzle_a["puzzle_id"], puzzle_b["puzzle_id"])
        self.assertNotEqual(
            puzzle_a["target"]["canonical_name"], puzzle_b["target"]["canonical_name"]
        )

    def test_explicit_word_length_filtering(self):
        # Request 4 letters (e.g. ITZY, KARA)
        puzzle_4 = generate_name_guess_puzzle(
            self.conn,
            seed="seed-4",
            reference_date=self.ref_date,
            word_length=4,
        )
        self.assertEqual(puzzle_4["word_length"], 4)
        self.assertEqual(len(puzzle_4["target"]["normalized_name"]), 4)
        self.assertTrue(all(len(w) == 4 for w in puzzle_4["valid_guesses"]))

        # Request 8 letters (NewJeans -> NEWJEANS)
        puzzle_8 = generate_name_guess_puzzle(
            self.conn,
            seed="seed-8",
            reference_date=self.ref_date,
            word_length=8,
        )
        self.assertEqual(puzzle_8["word_length"], 8)
        self.assertEqual(puzzle_8["target"]["normalized_name"], "NEWJEANS")

    def test_target_normalized_name_in_valid_guesses(self):
        puzzle = generate_name_guess_puzzle(
            self.conn,
            seed="seed-guesses",
            reference_date=self.ref_date,
        )
        target_norm = puzzle["target"]["normalized_name"]
        self.assertIn(target_norm, puzzle["valid_guesses"])
        self.assertTrue(all(w.isupper() and w.isalpha() for w in puzzle["valid_guesses"]))
        self.assertEqual(len(puzzle["valid_guesses"]), len(set(puzzle["valid_guesses"])))

    def test_clues_and_evidence_population(self):
        puzzle = generate_name_guess_puzzle(
            self.conn,
            seed="seed-clues",
            reference_date=self.ref_date,
            word_length=5,
        )
        target = puzzle["target"]
        self.assertIn("clues", target)
        clues = target["clues"]
        self.assertIn("debut_year", clues)
        self.assertIn("agency", clues)
        self.assertIn("members_count", clues)
        self.assertIn("description", clues)
        self.assertIn("pt-BR", clues["description"])
        self.assertIn("en", clues["description"])

        evidence = target["evidence"]
        self.assertGreaterEqual(len(evidence), 1)
        for ev in evidence:
            self.assertTrue(ev["source_url"].startswith("https://"))
            self.assertGreaterEqual(ev["revision_id"], 1)

    def test_insufficient_entities_raises_error(self):
        empty_conn = sqlite3.connect(":memory:")
        empty_conn.row_factory = sqlite3.Row
        empty_conn.executescript(
            """
            CREATE TABLE entities (id INTEGER PRIMARY KEY, wikidata_id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL);
            CREATE TABLE entity_aliases (entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts (
                id INTEGER PRIMARY KEY, statement_id TEXT NOT NULL UNIQUE, subject_entity_id INTEGER NOT NULL,
                predicate TEXT NOT NULL, property_id TEXT, rank TEXT, value_wikidata_id TEXT, value_entity_id INTEGER,
                value_time TEXT, value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER,
                valid_to TEXT, valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT,
                status TEXT NOT NULL, status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT
            );
            CREATE TABLE fact_evidence (fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT, reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
            CREATE TABLE wikidata_entity_snapshots (id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_revisions (id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE source_pages (id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER);
            """
        )
        with self.assertRaises(ValueError) as ctx:
            generate_name_guess_puzzle(empty_conn, seed="empty")
        self.assertIn("No eligible entities with evidence found", str(ctx.exception))
        empty_conn.close()

    def test_word_length_out_of_bounds_raises_error(self):
        with self.assertRaises(ValueError):
            generate_name_guess_puzzle(self.conn, seed="bad", word_length=2)
        with self.assertRaises(ValueError):
            generate_name_guess_puzzle(self.conn, seed="bad", word_length=11)

    def test_max_attempts_out_of_bounds_raises_error(self):
        with self.assertRaises(ValueError):
            generate_name_guess_puzzle(self.conn, seed="bad", max_attempts=3)
        with self.assertRaises(ValueError):
            generate_name_guess_puzzle(self.conn, seed="bad", max_attempts=9)

    def test_generate_puzzle_person_with_partial_facts(self):
        """Verify clue extraction and artist description generation for person entity with partial facts."""
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE entities (id INTEGER PRIMARY KEY, wikidata_id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL);
            CREATE TABLE entity_aliases (entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts (
                id INTEGER PRIMARY KEY, statement_id TEXT NOT NULL UNIQUE, subject_entity_id INTEGER NOT NULL,
                predicate TEXT NOT NULL, property_id TEXT, rank TEXT, value_wikidata_id TEXT, value_entity_id INTEGER,
                value_time TEXT, value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER,
                valid_to TEXT, valid_to_precision INTEGER, qualifiers_json TEXT, references_json TEXT,
                status TEXT NOT NULL, status_reason TEXT, quality_flags_json TEXT, extractor_version TEXT
            );
            CREATE TABLE fact_evidence (fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT, reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
            CREATE TABLE wikidata_entity_snapshots (id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_revisions (id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE source_pages (id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER);
            """
        )
        conn.execute("INSERT INTO wikidata_entity_snapshots VALUES (1, 'QSOURCE', 1001)")
        conn.execute(
            "INSERT INTO entities(id, wikidata_id, entity_type, canonical_name) VALUES (1, 'Q20000001', 'person', 'JISOO')"
        )
        conn.execute("INSERT INTO entity_aliases VALUES (1, 'en', 'JISOO', 'label')")
        conn.execute("INSERT INTO entity_aliases VALUES (1, 'pt', 'JISOO', 'label')")
        conn.execute(
            """
            INSERT INTO facts(
                id, statement_id, subject_entity_id, predicate, property_id, rank,
                value_time, value_precision, status, quality_flags_json
            ) VALUES (1, 'stmt-born-Q20000001', 1, 'born_on', 'P569', 'normal', '1995-01-03', 11, 'accepted', '[]')
            """
        )
        conn.execute(
            """
            INSERT INTO fact_evidence(fact_id, evidence_type, source_key, locator, wikidata_snapshot_id)
            VALUES (1, 'claim', 'wikidata', 'claims/P569/Q20000001', 1)
            """
        )
        conn.commit()

        puzzle = generate_name_guess_puzzle(
            conn,
            seed="seed-person-partial",
            reference_date=self.ref_date,
        )
        validate_name_guess_puzzle(puzzle)
        target = puzzle["target"]
        self.assertEqual(target["id"], "Q20000001")
        self.assertEqual(target["entity_type"], "person")
        self.assertEqual(target["canonical_name"], "JISOO")
        self.assertEqual(target["normalized_name"], "JISOO")
        self.assertEqual(target["clues"]["debut_year"], 1995)
        self.assertNotIn("agency", target["clues"])
        self.assertNotIn("members_count", target["clues"])
        self.assertIn("Artista e personalidade musical", target["clues"]["description"]["pt-BR"])
        self.assertIn("em atividade desde 1995.", target["clues"]["description"]["pt-BR"])
        self.assertIn("K-pop artist and music performer", target["clues"]["description"]["en"])
        self.assertIn("active since 1995.", target["clues"]["description"]["en"])
        conn.close()

    def test_word_length_rotation_across_seeds_without_length_param(self):
        """Verify word length rotates across different seeds when word_length is None."""
        lengths_seen: set[int] = set()
        for i in range(40):
            puzzle = generate_name_guess_puzzle(
                self.conn,
                seed=f"seed-rotation-{i}",
                reference_date=self.ref_date,
                word_length=None,
            )
            lengths_seen.add(puzzle["word_length"])

        # The test database contains candidate words of lengths 4, 5, and 8
        self.assertGreater(len(lengths_seen), 1)
        self.assertTrue({4, 5, 8}.issubset(lengths_seen))

    def _add_entity(
        self,
        qid: str,
        canonical: str,
        pt: str,
        en: str,
        *,
        with_evidence: bool,
    ) -> None:
        cur = self.conn.execute(
            "INSERT INTO entities(wikidata_id, entity_type, canonical_name) VALUES (?, 'group', ?)",
            (qid, canonical),
        )
        entity_id = cur.lastrowid
        self.conn.execute("INSERT INTO entity_aliases VALUES (?, 'pt', ?, 'label')", (entity_id, pt))
        self.conn.execute("INSERT INTO entity_aliases VALUES (?, 'en', ?, 'label')", (entity_id, en))
        if with_evidence:
            fact = self.conn.execute(
                """
                INSERT INTO facts(
                    statement_id, subject_entity_id, predicate, property_id, rank,
                    value_time, value_precision, status, quality_flags_json
                ) VALUES (?, ?, 'formed_on', 'P571', 'normal', '2017-01-01', 9, 'accepted', '[]')
                """,
                (f"stmt-formed-{qid}", entity_id),
            )
            self.conn.execute(
                """
                INSERT INTO fact_evidence(fact_id, evidence_type, source_key, locator, wikidata_snapshot_id)
                VALUES (?, 'claim', 'wikidata', ?, 1)
                """,
                (fact.lastrowid, f"claims/P571/{qid}"),
            )
        self.conn.commit()

    def _generate(self, seed: str = "labels", word_length: int = 7) -> dict:
        # Cravity is the only seven-letter candidate, so it is always the target.
        puzzle = generate_name_guess_puzzle(
            self.conn, seed=seed, reference_date=self.ref_date, word_length=word_length
        )
        self.assertEqual(puzzle["target"]["id"], "Q30000001")
        self.assertEqual(puzzle["target"]["normalized_name"], "CRAVITY")
        return puzzle

    @staticmethod
    def _recomputed_id(puzzle: dict) -> str:
        """The contract's identity, recomputed here from the published bytes."""
        return hash_payload({k: v for k, v in puzzle.items() if k != "puzzle_id"})

    # Ids the pre-cleanup generator (master) produced for the same database.
    MASTER_ID_SUFFIXED = "9c331257c24ad9ca5b3050e50b40390625b89d1088616d05b37689fb9fcf38ba"
    MASTER_ID_SUFFIXED_WITH_HOMONYM = "8ad656c689a699d37b21389a3c1fab60b343a2fd08e32340603a2e2db32b772f"
    MASTER_ID_CASE_DIFFERS = "7c064c71d4722c7b80812f191403e5b79917b975d5d9f5a51164e7dc0b9f8a72"

    def test_published_labels_are_the_labels_the_sources_gave(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        puzzle = self._generate()
        self.assertEqual(
            puzzle["target"]["labels"],
            {"pt-BR": "Cravity (grupo)", "en": "Cravity (group)"},
        )

    def test_puzzle_id_recomputes_from_the_published_payload(self):
        cases = {
            "suffix": [("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", True)],
            "suffix with catalog homonym": [
                ("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", True),
                ("Q30000002", "Cravity (band)", "Cravity (banda)", "Cravity (band)", False),
            ],
            "bare peer": [
                ("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", True),
                ("Q30000002", "Cravity", "Cravity", "Cravity", False),
            ],
            "case differs from canonical": [("Q30000001", "CRAVITY", "Cravity", "CRAVITY", True)],
            "reviewed spelling stays as published": [("Q30000001", "Cravity", "shinee", "SHINee", True)],
        }
        for name, entities in cases.items():
            with self.subTest(case=name):
                self.setUp()
                for entity in entities:
                    self._add_entity(entity[0], entity[1], entity[2], entity[3], with_evidence=entity[4])
                puzzle = self._generate()
                self.assertEqual(puzzle["puzzle_id"], self._recomputed_id(puzzle))
                validate_name_guess_puzzle(puzzle)

    def test_any_edit_of_the_published_label_is_detected(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        puzzle = self._generate()
        for locale, edited in (("pt-BR", "Cravity"), ("en", "Cravity"), ("pt-BR", "CRAVITY")):
            with self.subTest(locale=locale, edited=edited):
                tampered = json.loads(json.dumps(puzzle))
                tampered["target"]["labels"][locale] = edited
                self.assertNotEqual(self._recomputed_id(tampered), puzzle["puzzle_id"])
                with self.assertRaises(ValueError) as ctx:
                    validate_name_guess_puzzle(tampered)
                self.assertIn("puzzle_id does not match", str(ctx.exception))

    def test_puzzle_id_matches_the_one_published_before_the_cleanup_work(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        self.assertEqual(self._generate()["puzzle_id"], self.MASTER_ID_SUFFIXED)

    def test_catalog_homonym_does_not_move_the_id_or_the_labels(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        alone = self._generate()
        # Not a candidate (no evidence), but a catalog entity with the same short form.
        self._add_entity("Q30000002", "Cravity (band)", "Cravity (banda)", "Cravity (band)", with_evidence=False)
        with_homonym = self._generate()
        # The labels are the source's, whatever else the catalog holds. A homonym
        # changes dataset_version (the catalog differs), never the label policy.
        self.assertEqual(alone["target"]["labels"], with_homonym["target"]["labels"])
        self.assertEqual(with_homonym["puzzle_id"], self.MASTER_ID_SUFFIXED_WITH_HOMONYM)
        self.assertNotEqual(alone["puzzle_id"], with_homonym["puzzle_id"])

    def test_case_differing_from_canonical_is_published_and_identified_as_is(self):
        self._add_entity("Q30000001", "CRAVITY", "Cravity", "CRAVITY", with_evidence=True)
        puzzle = self._generate()
        self.assertEqual(puzzle["target"]["labels"], {"pt-BR": "Cravity", "en": "CRAVITY"})
        self.assertEqual(puzzle["puzzle_id"], self.MASTER_ID_CASE_DIFFERS)

    def test_answer_key_and_aliases_come_from_names_not_from_labels(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        # An alias in the catalog is a valid guess of its length; the label
        # note never leaks into the answer or the guess list.
        entity_id = self.conn.execute(
            "SELECT id FROM entities WHERE wikidata_id = 'Q30000001'"
        ).fetchone()[0]
        for alias in ("Cravity", "Craviti"):
            self.conn.execute(
                "INSERT INTO entity_aliases VALUES (?, 'en', ?, 'alias')", (entity_id, alias)
            )
        self.conn.commit()
        puzzle = self._generate()
        self.assertEqual(puzzle["target"]["normalized_name"], "CRAVITY")
        self.assertIn("CRAVITY", puzzle["valid_guesses"])
        self.assertIn("CRAVITI", puzzle["valid_guesses"])
        self.assertFalse(any("GRUPO" in guess or "GROUP" in guess for guess in puzzle["valid_guesses"]))
        self.assertEqual(puzzle["target"]["id"], "Q30000001")

    def test_regeneration_is_byte_identical_and_keeps_facts(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        first = self._generate()
        again = self._generate()
        self.assertEqual(
            json.dumps(first, sort_keys=True, ensure_ascii=False),
            json.dumps(again, sort_keys=True, ensure_ascii=False),
        )
        self.assertEqual(first["puzzle_id"], again["puzzle_id"])
        evidence = first["target"]["evidence"]
        self.assertEqual([item["locator"] for item in evidence], ["claims/P571/Q30000001"])
        self.assertEqual({item["revision_id"] for item in evidence}, {1001})
        self.assertEqual(evidence, again["target"]["evidence"])

    def test_distinct_entities_with_the_same_short_label_keep_distinct_ids(self):
        self._add_entity("Q30000001", "Cravity", "Cravity (grupo)", "Cravity (group)", with_evidence=True)
        first = self._generate()
        self.conn.execute("DELETE FROM entities WHERE wikidata_id = 'Q30000001'")
        self.conn.commit()
        self._add_entity("Q30000003", "Cravity", "Cravity (banda)", "Cravity (band)", with_evidence=True)
        second = generate_name_guess_puzzle(
            self.conn, seed="labels", reference_date=self.ref_date, word_length=7
        )
        self.assertNotEqual(first["target"]["id"], second["target"]["id"])
        self.assertNotEqual(first["puzzle_id"], second["puzzle_id"])


if __name__ == "__main__":
    unittest.main()
