"""Exercise the public CLI against synthetic snapshots and accepted facts."""

import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class PairsCoverageCliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.raw = self.root / "raw"
        self.raw.mkdir()
        self.db = self.root / "facts.db"
        self.report = self.root / "report.json"
        c = sqlite3.connect(self.db)
        c.executescript("""
            CREATE TABLE entities(id INTEGER PRIMARY KEY, wikidata_id TEXT, entity_type TEXT, canonical_name TEXT);
            CREATE TABLE entity_aliases(entity_id INTEGER, language TEXT, name TEXT, alias_type TEXT);
            CREATE TABLE facts(id INTEGER PRIMARY KEY, statement_id TEXT, subject_entity_id INTEGER, predicate TEXT,
              value_entity_id INTEGER, value_time TEXT, value_precision INTEGER, valid_from TEXT,
              valid_from_precision INTEGER, valid_to TEXT, valid_to_precision INTEGER,
              quality_flags_json TEXT, status TEXT, status_reason TEXT);
            CREATE TABLE wikidata_entity_snapshots(id INTEGER PRIMARY KEY, wikidata_id TEXT, external_revision_id INTEGER);
            CREATE TABLE source_pages(id INTEGER PRIMARY KEY, wikidata_id TEXT, language TEXT, external_page_id INTEGER, revision_id INTEGER);
            CREATE TABLE source_revisions(id INTEGER PRIMARY KEY, source_page_id INTEGER, external_revision_id INTEGER);
            CREATE TABLE source_revision_wikitext(source_revision_id INTEGER, snapshot_path TEXT, content_sha256 TEXT);
            CREATE TABLE fact_evidence(fact_id INTEGER, evidence_type TEXT, source_key TEXT, locator TEXT,
              wikidata_snapshot_id INTEGER, source_revision_id INTEGER);
        """)
        for i in range(1, 5):
            c.execute("INSERT INTO entities VALUES (?, ?, 'group', ?)", (i, f"Q{i}", f"Group {i}"))
            c.execute("INSERT INTO entities VALUES (?, ?, 'person', ?)", (10+i, f"Q{10+i}", f"Person {i}"))
            c.execute("INSERT INTO source_pages VALUES (?, ?, 'en', ?, ?)", (i, f"Q{i}", i, 100+i))
            c.execute("INSERT INTO source_revisions VALUES (?, ?, ?)", (i, i, 100+i))
            self.snapshot(c, i, f"[[Person {i}]]")
            self.fact(c, i, i, 10+i)
        c.commit()
        c.close()

    def snapshot(self, c, group, field):
        text = "{{Infobox musical artist\n|current_members = " + field + "\n}}"
        content = json.dumps({"pageid": group, "revid": 100+group, "wikitext": text}).encode()
        (self.raw / f"{group}.json").write_bytes(content)
        c.execute("DELETE FROM source_revision_wikitext WHERE source_revision_id=?", (group,))
        c.execute("INSERT INTO source_revision_wikitext VALUES (?, ?, ?)",
                  (group, f"{group}.json", hashlib.sha256(content).hexdigest()))

    def fact(self, c, fid, group, person):
        c.execute("INSERT INTO facts VALUES (?, ?, ?, 'has_member', ?, NULL,NULL,NULL,NULL,NULL,NULL,'[]','accepted',NULL)",
                  (fid, f"statement-{fid}", group, person))
        c.execute("INSERT INTO fact_evidence VALUES (?, 'wikipedia_revision', 'wikipedia:en', ?, NULL, ?)",
                  (fid, f"wikipedia:en:pageid={group}:revid={100+group}#wikitext[43:55]", group))

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, "-m", "kpop_scraping.pairs_coverage_cli",
            "--database", str(self.db), "--raw-root", str(self.raw), *map(str, extra)],
            text=True, capture_output=True)

    def output(self):
        result = self.run_cli("--output", self.report)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(self.report.read_text())

    def test_ready_reproducible_and_reconstructed(self):
        report = self.output()
        self.assertEqual(report["status"], "ready")
        self.assertEqual(len(report["sample"]["matrix"]), 16)
        self.assertEqual(report["sample"]["matching_count"], 1)
        self.assertEqual(self.run_cli("--verify", self.report).returncode, 0)
        report["sample"]["pairs"][0]["person_id"] = "Q999"
        self.report.write_text(json.dumps(report))
        self.assertNotEqual(self.run_cli("--verify", self.report).returncode, 0)

    def test_ambiguous_matching_is_insufficient(self):
        with sqlite3.connect(self.db) as c:
            for group in range(1, 5):
                self.snapshot(c, group, "{{ubl|[[Person 1]]|[[Person 2]]|[[Person 3]]|[[Person 4]]}}")
                for person in range(1, 5):
                    self.fact(c, 100+group*10+person, group, 10+person)
                # Entire closed field citation supports each synthetic relation.
                c.execute("UPDATE fact_evidence SET locator=? WHERE source_revision_id=?",
                          (f"wikipedia:en:pageid={group}:revid={100+group}#wikitext[43:55]", group))
        report = self.output()
        self.assertEqual(report["closed_rosters"], 4)
        self.assertEqual(report["status"], "insufficient_coverage")

    def test_missing_evidence_and_unparsed_content_fail_closed(self):
        with sqlite3.connect(self.db) as c:
            c.execute("DELETE FROM fact_evidence WHERE fact_id=1")
            self.snapshot(c, 2, "[[Person 2]]\n{{unknown|hidden member}}")
        report = self.output()
        self.assertEqual(report["status"], "insufficient_coverage")
        self.assertIn("missing_roster_relation_evidence", report["rejected_rosters"])
        self.assertIn("unparsed_roster_content", report["rejected_rosters"])

    def test_unknown_identity_and_hash_mismatch_fail_closed(self):
        with sqlite3.connect(self.db) as c:
            self.snapshot(c, 1, "[[Unresolved person]]")
        (self.raw / "2.json").write_text("{}")
        report = self.output()
        self.assertEqual(report["status"], "insufficient_coverage")
        self.assertIn("snapshot_hash_mismatch", report["rejected_rosters"])
        self.assertIn("unresolved_roster_identity", report["rejected_rosters"])

    def test_inputs_protected_through_aliases(self):
        original = self.db.read_bytes()
        alias = self.root / "alias.db"
        alias.symlink_to(self.db)
        for output in (self.db, alias, self.raw / "1.json"):
            self.assertNotEqual(self.run_cli("--output", output).returncode, 0)
        hardlink = self.root / "hard.db"
        hardlink.hardlink_to(self.db)
        self.assertNotEqual(self.run_cli("--output", hardlink).returncode, 0)
        self.assertEqual(self.db.read_bytes(), original)

    def test_roster_evidence_requires_matching_page_revision_and_nonempty_span(self):
        original = self.db.read_bytes()
        for locator in [
            'wikipedia:en:pageid=999999:revid=1#wikitext[43:55]',
            'wikipedia:en:pageid=2:revid=101#wikitext[43:55]',
            'wikipedia:en:pageid=1:revid=102#wikitext[43:55]',
            'wikipedia:en:pageid=1:revid=101#wikitext[55:43]',
            'wikipedia:en:pageid=1:revid=101#wikitext[43:43]',
        ]:
            with self.subTest(locator=locator):
                self.db.write_bytes(original)
                with sqlite3.connect(self.db) as c:
                    c.execute('UPDATE fact_evidence SET locator=? WHERE fact_id=1', (locator,))
                report = self.output()
                self.assertEqual(report['status'], 'insufficient_coverage')
                self.assertEqual(report['closed_rosters'], 3)
                self.assertIn('missing_roster_relation_evidence', report['rejected_rosters'])

    def test_unknown_named_parameter_and_duplicate_field_not_dropped(self):
        with sqlite3.connect(self.db) as c:
            self.snapshot(c, 1, "{{ubl|[[Person 1]]|unknown=[[Hidden person]]}}")
            self.snapshot(c, 2, "[[Person 2]]\n|current_members = [[Hidden person]]")
        report = self.output()
        self.assertEqual(report["status"], "insufficient_coverage")
        self.assertIn("unparsed_roster_content", report["rejected_rosters"])
        self.assertIn("missing_or_duplicate_current_members", report["rejected_rosters"])
