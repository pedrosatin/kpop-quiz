import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from kpop_scraping.geo_coverage import build_geo_coverage_report, main


def build_test_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE source_pages (
            id INTEGER PRIMARY KEY, provider TEXT, language TEXT, external_page_id INTEGER
        );
        CREATE TABLE catalog_entries (source_page_id INTEGER PRIMARY KEY, state TEXT);
        CREATE TABLE catalog_entity_links (source_page_id INTEGER, entity_id INTEGER);
        CREATE TABLE entities (
            id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT,
            canonical_name TEXT, last_fact_run_id INTEGER
        );
        CREATE TABLE facts (
            subject_entity_id INTEGER, predicate TEXT, value_entity_id INTEGER,
            value_wikidata_id TEXT, status TEXT
        );
        INSERT INTO source_pages VALUES
            (1, 'wikipedia', 'en', 1), (2, 'wikipedia', 'en', 2),
            (3, 'wikipedia', 'ko', 3);
        INSERT INTO catalog_entries VALUES
            (1, 'accepted'), (2, 'accepted'), (3, 'accepted');
        INSERT INTO catalog_entity_links VALUES (1, 1), (2, 2), (3, 1);
        INSERT INTO entities VALUES
            (1, 'QGROUP1', 'group', 'Group One', 1),
            (2, 'QGROUP2', 'group', 'Group Two', 1),
            (3, 'QPERSON1', 'person', 'Person One', 1),
            (4, 'QPERSON2', 'person', 'Person Two', 1),
            (5, 'QKOREA', 'place', 'South Korea', 1),
            (6, 'QCITY', 'place', 'Seoul', 1),
            (7, 'QMYANMAR', 'place', 'Myanmar', 1);
        INSERT INTO facts VALUES
            (1, 'origin_country', 5, 'QKOREA', 'accepted'),
            (2, 'origin_country', 7, 'QMYANMAR', 'rejected'),
            (1, 'has_member', 3, 'QPERSON1', 'accepted'),
            (2, 'has_member', 3, 'QPERSON1', 'accepted'),
            (4, 'member_of', 2, 'QGROUP2', 'accepted'),
            (3, 'born_in', 6, 'QCITY', 'accepted'),
            (4, 'born_in', 7, 'QMYANMAR', 'rejected');
        """
    )
    connection.commit()
    connection.close()


class GeoCoverageTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.database = self.root / "catalog.db"
        build_test_database(self.database)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_report_separates_country_origins_from_unresolved_birthplaces(self):
        connection = sqlite3.connect(self.database)
        connection.row_factory = sqlite3.Row
        report = build_geo_coverage_report(connection)
        connection.close()

        self.assertEqual(report["scope"], {
            "accepted_catalog_groups": 2,
            "groups_with_fact_run": 2,
            "unique_members_of_processed_groups": 2,
        })
        self.assertEqual(report["origin_country"]["subjects_with_accepted_fact"], 1)
        self.assertEqual(report["origin_country"]["distinct_accepted_values"], 1)
        self.assertEqual(
            report["origin_country"]["accepted_value_distribution"],
            [{"wikidata_id": "QKOREA", "name": "South Korea", "facts": 1}],
        )
        self.assertEqual(report["born_in"]["eligible_subjects"], 2)
        self.assertEqual(report["born_in"]["subjects_with_accepted_fact"], 1)
        self.assertEqual(report["born_in"]["geographic_resolution"], "not_performed")

    def test_cli_reads_database_without_modifying_it(self):
        before = self.database.read_bytes()
        output = self.root / "reports" / "geo.json"
        self.assertEqual(
            main(["--database", str(self.database), "--output", str(output)]), 0
        )
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(
            json.loads(output.read_text(encoding="utf-8"))["report_version"],
            "geo-coverage-v1",
        )


if __name__ == "__main__":
    unittest.main()
