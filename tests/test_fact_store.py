import unittest
import tempfile
import sqlite3
from pathlib import Path
from unittest.mock import Mock

from kpop_scraping.evidence import EVIDENCE_RULES_VERSION
from kpop_scraping.storage import MIGRATIONS, Repository, apply_migrations
from kpop_scraping.fact_store import FactStore, FactRunTotals, count_statuses, _json, CatalogGroup
from kpop_scraping.validation import FactDecision, ACCEPTED, REJECTED, CONFLICT, SUPERSEDED

class FactStoreTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.repository = Repository(self.root / "test.db", raw_dir=self.root / "raw")
        self.store = FactStore(self.repository)

    def tearDown(self):
        self.repository.connection.close()
        self.directory.cleanup()

    def test_run_lifecycle(self):
        run_id = self.store.start_run("1.0.0", 100)
        self.assertGreater(run_id, 0)

        row = self.store.connection.execute("SELECT status FROM fact_runs WHERE id=?", (run_id,)).fetchone()
        self.assertEqual(row["status"], "running")

        totals = FactRunTotals(1, 2, 3, 4, 5, 6, 7, 8)
        self.store.complete_run(run_id, totals)

        row = self.store.connection.execute("SELECT status, groups_processed FROM fact_runs WHERE id=?", (run_id,)).fetchone()
        self.assertEqual(row["status"], "completed")
        self.assertEqual(row["groups_processed"], 1)

        run_id2 = self.store.start_run("1.0.0", 100)
        self.store.fail_run(run_id2, "test error")
        row = self.store.connection.execute("SELECT status, error FROM fact_runs WHERE id=?", (run_id2,)).fetchone()
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "test error")

    def test_run_records_the_evidence_rules_version(self):
        run_id = self.store.start_run("1.0.0", None)
        self.store.complete_run(run_id, FactRunTotals(0, 0, 0, 0, 0, 0, 0, 0))
        row = self.store.connection.execute(
            "SELECT evidence_rules_version FROM fact_runs WHERE id=?", (run_id,)
        ).fetchone()
        self.assertEqual(row["evidence_rules_version"], EVIDENCE_RULES_VERSION)

    def test_migration_keeps_older_fact_runs_without_a_version(self):
        database = self.root / "v10.db"
        connection = sqlite3.connect(database)
        apply_migrations(connection, [m for m in MIGRATIONS if m[0] <= 10])
        connection.execute(
            """INSERT INTO fact_runs(id, extractor_version, source_policy_version,
                   started_at, completed_at, status, facts_accepted)
               VALUES (4, 'facts-v1', 'sources-v1', 't0', 't1', 'completed', 12)"""
        )
        connection.commit()
        connection.close()
        with Repository(database, raw_dir=self.root / "raw10") as repository:
            row = repository.connection.execute(
                "SELECT id, status, facts_accepted, evidence_rules_version FROM fact_runs"
            ).fetchone()
            new_run = FactStore(repository).start_run("facts-v2", None)
            recorded = repository.connection.execute(
                "SELECT evidence_rules_version FROM fact_runs WHERE id=?", (new_run,)
            ).fetchone()[0]
        self.assertEqual(tuple(row), (4, "completed", 12, None))
        self.assertEqual(recorded, EVIDENCE_RULES_VERSION)

    def test_accepted_groups(self):
        self.store.connection.executescript("""
            INSERT INTO collection_runs (id, category, started_at, status) VALUES (1, 'test', '2023-01-01', 'completed');
            INSERT INTO source_pages (id, provider, language, external_page_id, canonical_url, title, extract, fetched_at, last_run_id)
            VALUES (1, 'wikipedia', 'en', 123, 'http://test1', 'Test Group', 'extract1', '2023-01-01T00:00:00Z', 1);

            INSERT INTO source_revisions (id, source_page_id, external_revision_id, snapshot_path, content_sha256, fetched_at)
            VALUES (1, 1, 456, 'path1', '1234567890123456789012345678901234567890123456789012345678901234', '2023-01-01T00:00:00Z');

            INSERT INTO catalog_entries (source_page_id, source_revision_id, state, analyzed_wikidata_id, classifier_version, classified_at)
            VALUES (1, 1, 'accepted', 'Q1', '1.0', '2023-01-01T00:00:00Z');

            INSERT INTO source_pages (id, provider, language, external_page_id, canonical_url, title, extract, fetched_at, last_run_id)
            VALUES (2, 'wikipedia', 'ko', 124, 'http://test2', 'Korean Group', 'extract2', '2023-01-01T00:00:00Z', 1);

            INSERT INTO source_revisions (id, source_page_id, external_revision_id, snapshot_path, content_sha256, fetched_at)
            VALUES (2, 2, 457, 'path2', '1234567890123456789012345678901234567890123456789012345678901235', '2023-01-01T00:00:00Z');

            INSERT INTO catalog_entries (source_page_id, source_revision_id, state, analyzed_wikidata_id, classifier_version, classified_at)
            VALUES (2, 2, 'accepted', 'Q2', '1.0', '2023-01-01T00:00:00Z');

            INSERT INTO source_pages (id, provider, language, external_page_id, canonical_url, title, extract, fetched_at, last_run_id)
            VALUES (3, 'wikipedia', 'ja', 125, 'http://test3', 'Rejected Group', 'extract3', '2023-01-01T00:00:00Z', 1);

            INSERT INTO source_revisions (id, source_page_id, external_revision_id, snapshot_path, content_sha256, fetched_at)
            VALUES (3, 3, 458, 'path3', '1234567890123456789012345678901234567890123456789012345678901236', '2023-01-01T00:00:00Z');

            INSERT INTO catalog_entries (source_page_id, source_revision_id, state, analyzed_wikidata_id, classifier_version, classified_at, rejection_reason)
            VALUES (3, 3, 'rejected', 'Q3', '1.0', '2023-01-01T00:00:00Z', 'just because');
        """)
        self.store.connection.commit()

        groups = self.store.accepted_groups()
        self.assertEqual(len(groups), 2)
        wikidata_ids = [g.wikidata_id for g in groups]
        self.assertIn('Q1', wikidata_ids)
        self.assertIn('Q2', wikidata_ids)

        # Test limit
        groups = self.store.accepted_groups(limit=1)
        self.assertEqual(len(groups), 1)

    def test_count_statuses(self):
        mock_accepted = Mock(spec=FactDecision)
        mock_accepted.status = ACCEPTED
        mock_rejected = Mock(spec=FactDecision)
        mock_rejected.status = REJECTED
        mock_conflict = Mock(spec=FactDecision)
        mock_conflict.status = CONFLICT

        totals = count_statuses([mock_accepted, mock_accepted, mock_rejected, mock_conflict])
        self.assertEqual(totals[ACCEPTED], 2)
        self.assertEqual(totals[REJECTED], 1)
        self.assertEqual(totals[CONFLICT], 1)
        self.assertEqual(totals[SUPERSEDED], 0)

    def test_json(self):
        self.assertEqual(_json({"a": 1}), '{"a":1}')

if __name__ == '__main__':
    unittest.main()
