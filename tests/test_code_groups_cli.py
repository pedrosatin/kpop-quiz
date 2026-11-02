"""Public CLI contract tests, independent of generator implementation."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CodeGroupsCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.database = Path(self.tmp.name) / "groups.db"
        self.output = Path(self.tmp.name) / "pilot.json"
        with sqlite3.connect(self.database) as c:
            c.executescript("""
                CREATE TABLE source_pages(id INTEGER, wikidata_id TEXT, title TEXT);
                CREATE TABLE catalog_entries(source_page_id INTEGER, analyzed_wikidata_id TEXT, state TEXT, type_check_id INTEGER);
                CREATE TABLE wikidata_type_checks(id INTEGER, wikidata_id TEXT, external_revision_id INTEGER, instance_of_json TEXT);
            """)
            for i in range(1, 9):
                c.execute("INSERT INTO source_pages VALUES (?, ?, ?)", (i, f"Q{i}", f"Group {i}"))
                c.execute("INSERT INTO catalog_entries VALUES (?, ?, ?, ?)", (i, f"Q{i}", "accepted" if i < 8 else "rejected", i))
                c.execute("INSERT INTO wikidata_type_checks VALUES (?, ?, ?, ?)", (i, f"Q{i}", 100+i, '["Q215380"]'))

    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-m", "kpop_scraping.code_groups_cli", *map(str,args)], cwd=ROOT, text=True, capture_output=True)

    def generate(self):
        return self.run_cli("--database", self.database, "--date", "2026-10-12", "--seed", "fixture", "--output", self.output)

    def test_reproducible_read_only_generation_and_verify(self):
        before = self.database.read_bytes()
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        first = self.output.read_bytes()
        self.assertEqual(self.generate().returncode, 0)
        self.assertEqual(first, self.output.read_bytes())
        self.assertEqual(before, self.database.read_bytes())
        p = json.loads(first)
        self.assertEqual(p["mode"], "pilot")
        self.assertEqual(len({s["qid"] for s in p["symbols"]}), 6)
        self.assertNotIn("Q8", [s["qid"] for s in p["symbols"]])
        self.assertEqual(self.run_cli("--verify", self.output).returncode, 0)

    def test_wikipedia_notes_in_titles_do_not_change_identity_or_draw(self):
        """Hiding a note is the page's job: it must not move the dataset hash or the RNG.

        The values below come from the generator before display-name cleanup
        existed. Cleaning titles in the generator changes dataset_version,
        puzzle_id, the six symbols and the secret for the same catalog and date.
        """
        titles = {1: "Tempest (group)", 2: "Tempest (band)", 3: "Group 3 (band)"}
        with sqlite3.connect(self.database) as c:
            for source_id, title in titles.items():
                c.execute("UPDATE source_pages SET title=? WHERE id=?", (title, source_id))
        self.assertEqual(self.generate().returncode, 0)
        puzzle = json.loads(self.output.read_text())
        self.assertEqual(puzzle["puzzle_id"], "f58d5d1b6dedf9f44db21c515dd2ce7c59905bd2d8560aa989aa8226f484b68a")
        self.assertEqual(puzzle["dataset_version"], "cb1bbf1cf2f24e0745402302dba4dbe427cdedecd4a2f259328ce11587480993")
        self.assertEqual(puzzle["secret"], ["Q1", "Q3", "Q7", "Q2"])
        names = {symbol["qid"]: symbol["name"] for symbol in puzzle["symbols"]}
        self.assertEqual(names["Q1"], "Tempest (group)")
        self.assertEqual(names["Q2"], "Tempest (band)")
        self.assertEqual(names["Q3"], "Group 3 (band)")
        self.assertEqual(self.run_cli("--verify", self.output, "--database", self.database).returncode, 0)

    def test_verifier_rejects_contract_violations(self):
        self.assertEqual(self.generate().returncode, 0)
        original = json.loads(self.output.read_text())
        for field,value in [("mode","daily"),("secret",["Q1"]*4),("max_attempts",9),("symbols",[])]:
            with self.subTest(field=field):
                broken = {**original,field:value}
                self.output.write_text(json.dumps(broken))
                self.assertNotEqual(self.run_cli("--verify",self.output).returncode,0)
        broken = json.loads(json.dumps(original))
        broken["symbols"][0]["source"]["url"] = "https://www.wikidata.org/wiki/Q1"
        self.output.write_text(json.dumps(broken))
        self.assertNotEqual(self.run_cli("--verify",self.output).returncode,0)

    def test_insufficient_accepted_groups_fails_without_artifact(self):
        with sqlite3.connect(self.database) as c:
            c.execute("UPDATE catalog_entries SET state='candidate' WHERE source_page_id>5")
        result = self.generate()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("insufficient accepted group coverage",result.stderr)
        self.assertFalse(self.output.exists())

    def test_hash_tampering_and_database_origin_are_verified(self):
        self.assertEqual(self.generate().returncode,0)
        self.assertEqual(self.run_cli("--verify",self.output,"--database",self.database).returncode,0)
        puzzle=json.loads(self.output.read_text())
        puzzle["secret"]=list(reversed(puzzle["secret"]))
        self.output.write_text(json.dumps(puzzle))
        self.assertNotEqual(self.run_cli("--verify",self.output).returncode,0)
        self.assertEqual(self.generate().returncode,0)
        with sqlite3.connect(self.database) as c:
            c.execute("UPDATE source_pages SET title=title||' changed'")
        self.assertNotEqual(self.run_cli("--verify",self.output,"--database",self.database).returncode,0)

    def test_database_cannot_be_overwritten_through_output_or_symlink(self):
        before=self.database.read_bytes()
        alias=Path(self.tmp.name)/"alias.db"
        alias.symlink_to(self.database)
        for output in [self.database,alias]:
            self.assertNotEqual(self.run_cli("--database",self.database,"--date","2026-10-12","--output",output).returncode,0)
        self.assertEqual(before,self.database.read_bytes())

    def test_missing_database_is_not_created(self):
        missing = Path(self.tmp.name)/"absent.db"
        self.assertNotEqual(self.run_cli("--database",missing,"--date","2026-10-12").returncode,0)
        self.assertFalse(missing.exists())
