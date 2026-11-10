"""A birthplace coarser than the person's infobox stays a fact but asks no question (ADR 027)."""

import json
import sqlite3
import unittest

from kpop_scraping.person_evidence import COARSE_PLACE, is_coarse_birth_place
from kpop_scraping.quiz_repository import _load_entities, _load_facts

FACT_COLUMNS = (
    "statement_id", "subject_entity_id", "predicate", "value_entity_id", "value_time",
    "value_precision", "status", "status_reason", "quality_flags_json",
)


def build_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE entities(
            id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT
        );
        CREATE TABLE entity_aliases(
            entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT
        );
        CREATE TABLE facts(
            id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER,
            predicate TEXT, value_entity_id INTEGER, value_time TEXT,
            value_precision INTEGER, valid_from TEXT, valid_from_precision INTEGER,
            valid_to TEXT, valid_to_precision INTEGER, status TEXT, status_reason TEXT,
            quality_flags_json TEXT
        );
        CREATE TABLE fact_evidence(
            fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT,
            reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER,
            source_revision_id INTEGER
        );
        CREATE TABLE source_pages(
            id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER
        );
        CREATE TABLE source_revisions(
            id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER
        );
        CREATE TABLE wikidata_entity_snapshots(
            id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER
        );
        INSERT INTO entities VALUES
            (1, 'QPERSON', 'person', 'Person'), (2, 'QSEOUL', 'place', 'Seoul');
        INSERT INTO source_pages VALUES (1, 'wikipedia', 'en', 5000);
        INSERT INTO source_revisions VALUES (1, 1, 6000);
        """
    )
    return connection


def add_fact(connection, statement, predicate, status, flags, value_time=None):
    cursor = connection.execute(
        f"INSERT INTO facts({','.join(FACT_COLUMNS)}) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            statement, 1, predicate, 2 if predicate == "born_in" else None, value_time,
            11 if value_time else None, status,
            None if status == "accepted" else "stale", json.dumps(flags),
        ),
    )
    connection.execute(
        "INSERT INTO fact_evidence(fact_id, evidence_type, snippet, source_revision_id) "
        "VALUES (?, 'wikipedia_revision', 'birth_place = [[Seoul]]', 1)",
        (cursor.lastrowid,),
    )


class CoarseBirthPlaceTest(unittest.TestCase):
    def test_only_a_born_in_fact_with_the_mark_is_coarse(self):
        self.assertTrue(is_coarse_birth_place("born_in", [COARSE_PLACE]))
        self.assertTrue(is_coarse_birth_place("born_in", ("precision_below_day", COARSE_PLACE)))
        self.assertFalse(is_coarse_birth_place("born_in", []))
        self.assertFalse(is_coarse_birth_place("born_on", [COARSE_PLACE]))

    def test_quiz_inputs_drop_coarse_birthplaces_and_count_them(self):
        connection = build_database()
        add_fact(connection, "coarse", "born_in", "accepted", [COARSE_PLACE])
        add_fact(connection, "exact", "born_in", "accepted", [])
        add_fact(connection, "stale-coarse", "born_in", "stale", [COARSE_PLACE])
        add_fact(connection, "born", "born_on", "accepted", [], "1994-02-21")
        facts, rejected = _load_facts(connection, _load_entities(connection))

        self.assertEqual([fact.statement_id for fact in facts], ["born"])
        self.assertEqual(rejected["coarse_birth_place_excluded"], 1)
        # A fact that is not accepted is never counted as an exclusion.
        self.assertEqual(rejected["fact_stale__stale"], 1)
        # born_in is still not a quiz predicate; the exact one is skipped as before.
        self.assertEqual(rejected["unsupported_predicate"], 1)

    def test_exclusion_never_rewrites_the_stored_fact(self):
        connection = build_database()
        add_fact(connection, "coarse", "born_in", "accepted", [COARSE_PLACE])
        _load_facts(connection, _load_entities(connection))

        row = connection.execute(
            "SELECT status, quality_flags_json FROM facts WHERE statement_id = 'coarse'"
        ).fetchone()
        self.assertEqual(tuple(row), ("accepted", json.dumps([COARSE_PLACE])))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM fact_evidence").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
