"""Public CLI tests: complete facts prove negatives; omissions never do."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from kpop_scraping.venn_coverage import GREGORIAN


class VennCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "input.db"
        self.report = self.root / "report.json"
        self.sample = self.root / "sample.json"
        with closing(sqlite3.connect(self.database)) as c, c:
            c.executescript("""
                CREATE TABLE entities(id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT);
                CREATE TABLE facts(id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER,
                    predicate TEXT, property_id TEXT, value_time TEXT, value_precision INTEGER,
                    value_calendar TEXT, status TEXT);
                CREATE TABLE fact_evidence(fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT,
                    reference_hash TEXT, snippet TEXT, wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
                CREATE TABLE wikidata_entity_snapshots(id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
                CREATE TABLE source_pages(id INTEGER, external_page_id INTEGER, language TEXT, wikidata_id TEXT);
                CREATE TABLE source_revisions(id INTEGER, source_page_id INTEGER, external_revision_id INTEGER);
            """)
            # All nonempty combinations for year<2000, month<=6, day<=15.
            for mask in range(1, 8):
                born = f"{1999 if mask & 1 else 2000}-{2 if mask & 2 else 8:02d}-{10 if mask & 4 else 20:02d}"
                c.execute("INSERT INTO entities VALUES (?, ?, 'person', ?)", (mask, f"Q{mask}", f"Artist {mask}"))
                c.execute("INSERT INTO facts VALUES (?, ?, ?, 'born_on', 'P569', ?, 11, ?, 'accepted')",
                          (mask, f"Q{mask}$birth", mask, born, GREGORIAN))
                c.execute("INSERT INTO wikidata_entity_snapshots VALUES (?, ?, 123)", (mask, f"Q{mask}"))
                c.execute("INSERT INTO fact_evidence VALUES (?, 'wikidata_reference', 'domain:example.org', ?, ?, NULL, ?, NULL)",
                          (mask, f"claims/P569/Q{mask}$birth/references/{'a'*40}", 'a'*40, mask))

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, "-m", "kpop_scraping.venn_cli", "--database", str(self.database),
                               "--date", "2026-10-12", "--output", str(self.report), *extra],
                              text=True, capture_output=True)

    def update(self, sql):
        with closing(sqlite3.connect(self.database)) as c, c:
            c.execute(sql)

    def test_complete_fixture_passes_seven_regions_and_proves_negatives(self):
        original = self.database.read_bytes()
        result = self.run_cli("--sample-output", str(self.sample))
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["status"], "approved")
        self.assertEqual(report["eligible_count"], 7)
        sample = json.loads(self.sample.read_text())
        self.assertEqual([e["mask"] for e in sample["entities"]], list(range(1, 8)))
        self.assertEqual(len({e["qid"] for e in sample["entities"]}), 7)
        self.assertEqual(sample["entities"][0]["values"], [True, False, False])
        self.assertTrue(all(e["evidence"] for e in sample["entities"]))
        self.assertEqual(self.database.read_bytes(), original)
        before = self.report.read_bytes()
        self.assertEqual(self.run_cli().returncode, 0)
        self.assertEqual(before, self.report.read_bytes())
        self.assertEqual(self.run_cli("--verify", str(self.report), "--verify-sample", str(self.sample), "--output", str(self.root / "verified.json")).returncode, 0)

    def test_unknown_date_cannot_prove_negative_and_clears_old_sample(self):
        self.assertEqual(self.run_cli("--sample-output", str(self.sample)).returncode, 0)
        self.update("UPDATE facts SET value_time='1999', value_precision=9 WHERE id=1")
        result = self.run_cli("--sample-output", str(self.sample))
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["status"], "insufficient_coverage")
        self.assertIsNone(report["sample"])
        self.assertFalse(self.sample.exists())
        self.assertEqual(report["candidates"][0]["state"], "unknown")
        self.assertEqual(report["triples"][0]["classifications"][0]["values"], [None] * 3)
        self.assertIsNone(report["triples"][0]["classifications"][0]["mask"])
        self.assertEqual(self.run_cli("--verify", str(self.report), "--output", str(self.root / "verified.json")).returncode, 2)

    def test_missing_evidence_is_excluded(self):
        self.update("DELETE FROM fact_evidence WHERE fact_id=1")
        self.assertEqual(self.run_cli().returncode, 2)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["rejection_counts"]["missing_evidence"], 1)

    def test_unrelated_or_malformed_wikidata_locator_cannot_support_birth(self):
        original = self.database.read_bytes()
        for change in [
            "UPDATE fact_evidence SET locator='claims/P31/999/references/0' WHERE fact_id=1",
            "UPDATE fact_evidence SET locator='nonsense',reference_hash='not-a-hash' WHERE fact_id=1",
            "UPDATE fact_evidence SET locator=replace(locator,'Q1$birth','Q2$birth') WHERE fact_id=1",
            "UPDATE fact_evidence SET reference_hash='" + 'b'*40 + "' WHERE fact_id=1",
            "UPDATE wikidata_entity_snapshots SET wikidata_id='Q2' WHERE id=1",
        ]:
            with self.subTest(change=change):
                self.database.write_bytes(original)
                self.update(change)
                self.assertEqual(self.run_cli().returncode, 2)
                self.assertIn('missing_evidence', json.loads(self.report.read_text())['candidates'][0]['reasons'])

    def test_wikipedia_locator_must_match_subject_page_revision_and_nonempty_span(self):
        with closing(sqlite3.connect(self.database)) as c, c:
            c.execute("INSERT INTO source_pages VALUES(1,11,'en','Q1')")
            c.execute("INSERT INTO source_revisions VALUES(1,1,123)")
            c.execute("UPDATE fact_evidence SET evidence_type='wikipedia_revision', source_key='wikipedia:en',locator='wikipedia:en:pageid=11:revid=123#wikitext[10:20]',reference_hash=NULL,snippet='1999-08-20',wikidata_snapshot_id=NULL,source_revision_id=1 WHERE fact_id=1")
        self.assertEqual(self.run_cli().returncode, 0)
        original = self.database.read_bytes()
        for change in [
            "UPDATE source_pages SET wikidata_id='Q2'",
            "UPDATE fact_evidence SET locator=replace(locator,'pageid=11','pageid=12') WHERE fact_id=1",
            "UPDATE fact_evidence SET locator=replace(locator,'revid=123','revid=124') WHERE fact_id=1",
            "UPDATE fact_evidence SET locator=replace(locator,'[10:20]','[20:10]') WHERE fact_id=1",
            "UPDATE fact_evidence SET locator=replace(locator,'[10:20]','[10:10]') WHERE fact_id=1",
        ]:
            with self.subTest(change=change):
                self.database.write_bytes(original)
                self.update(change)
                self.assertEqual(self.run_cli().returncode, 2)
                self.assertIn('missing_evidence', json.loads(self.report.read_text())['candidates'][0]['reasons'])

    def test_wrong_masks_or_false_values_rejected_on_public_verification(self):
        self.assertEqual(self.run_cli().returncode, 0)
        good = json.loads(self.report.read_text())
        for key, bad in (("mask", 7), ("values", [True, True, True])):
            report = json.loads(json.dumps(good))
            report["sample"]["entities"][0][key] = bad
            self.report.write_text(json.dumps(report))
            self.assertEqual(self.run_cli("--verify", str(self.report), "--output", str(self.root / "verified.json")).returncode, 1)

    def test_independent_sample_is_verified_against_database(self):
        self.assertEqual(self.run_cli("--sample-output", str(self.sample)).returncode, 0)
        sample = json.loads(self.sample.read_text())
        sample["entities"][0]["evidence"] = []
        self.sample.write_text(json.dumps(sample))
        self.assertEqual(self.run_cli("--verify-sample", str(self.sample)).returncode, 1)

    def test_missing_fact_stays_unknown(self):
        self.update("DELETE FROM facts WHERE id=1")
        self.assertEqual(self.run_cli().returncode, 2)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["rejection_counts"]["missing_accepted_birth"], 1)

    def test_bad_dates_calendar_precision_and_conflicts_rejected(self):
        original = self.database.read_bytes()
        for sql, reason in [
            ("UPDATE facts SET value_time='1999-02-30' WHERE id=1", "invalid_or_incomplete_date"),
            ("UPDATE facts SET value_calendar='julian' WHERE id=1", "unsupported_calendar"),
            ("UPDATE facts SET value_precision=9 WHERE id=1", "insufficient_precision"),
            ("INSERT INTO facts SELECT 99, 'conflict', 1, predicate, property_id, value_time, value_precision, value_calendar, 'conflict' FROM facts WHERE id=1", "open_conflict"),
            ("INSERT INTO facts SELECT 98, 'second', 1, predicate, property_id, '1999-02-21', value_precision, value_calendar, status FROM facts WHERE id=1", "inconsistent_dates"),
        ]:
            with self.subTest(reason=reason):
                self.database.write_bytes(original)
                self.update(sql)
                self.assertEqual(self.run_cli().returncode, 2)
                self.assertIn(reason, json.loads(self.report.read_text())["rejection_counts"])

    def test_verification_input_cannot_be_overwritten(self):
        self.assertEqual(self.run_cli().returncode, 0)
        original = self.report.read_bytes()
        self.assertEqual(self.run_cli("--verify", str(self.report)).returncode, 1)
        self.assertEqual(self.report.read_bytes(), original)

    def test_missing_database_or_overwriting_input_returns_error(self):
        result = subprocess.run([sys.executable, "-m", "kpop_scraping.venn_cli", "--database", str(self.root / "missing.db")], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.root / "missing.db").exists())
        original = self.database.read_bytes()
        result = self.run_cli("--sample-output", str(self.database))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(original, self.database.read_bytes())


if __name__ == "__main__":
    unittest.main()
