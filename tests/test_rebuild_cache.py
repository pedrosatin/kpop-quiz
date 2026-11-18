"""Schema changes never consume the publication fallback or skip today's generation."""
import io
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import rebuild_cache
from kpop_scraping.daily_puzzles_runner import run_daily_puzzles
from kpop_scraping.crossword_publication import omission_record, write_record
from tests.daily_fixtures import reuse_quiz
from scripts.rebuild_database import rebuild, restore_cache, Limits


class SchemaCacheTest(unittest.TestCase):
    def test_schema_key_tracks_new_and_edited_migrations(self):
        version = rebuild_cache.schema_version()
        for migrations in (
            (*rebuild_cache.MIGRATIONS, (999, "new", ("CREATE TABLE changed(id)",))),
            ((1, "edited", ("ALTER TABLE source_revisions ADD COLUMN changed",)), *rebuild_cache.MIGRATIONS[1:]),
        ):
            with self.subTest(migrations=migrations[-1][0]), patch.object(rebuild_cache, "MIGRATIONS", migrations):
                self.assertNotEqual(rebuild_cache.schema_version(), version)

    def test_every_cache_and_refresh_outcome_generates_the_day(self):
        reuse_quiz(self)
        # The collector is simulated; the reserve, rebuild/fallback and daily
        # generators are real. No request to Wikimedia is made.
        for cache in ("same", "old-ddl", "same-ddl-different-marker", "same-ddl-missing-marker", "none"):
            for outcome in (0, 65, 75, None):
                with self.subTest(cache=cache, outcome=outcome), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder)
                    db = root / "kpop.db"
                    raw = root / "raw"
                    raw.mkdir()
                    if cache != "none":
                        rebuild_cache.install_reserve(db)
                        if cache == "old-ddl":
                            with sqlite3.connect(db) as connection:
                                connection.execute("ALTER TABLE facts DROP COLUMN quality_flags_json")
                                columns = {row[1] for row in connection.execute("PRAGMA table_info(facts)")}
                                self.assertNotIn("quality_flags_json", columns)
                        if cache != "same-ddl-missing-marker":
                            rebuild_cache.marker_path(db).write_text(
                                rebuild_cache.schema_version() if cache == "same" else "previous-schema"
                            )
                        (raw / "old.json").write_text("{}")
                    def attempt(command, timeout, grace):
                        self.assertEqual(db.exists(), cache == "same")
                        self.assertEqual((raw / "old.json").exists(), cache == "same")
                        if outcome == 0:
                            rebuild_cache.install_reserve(db)
                        else:
                            db.write_bytes(b"interrupted refresh")
                            raw.mkdir(exist_ok=True)
                            (raw / "partial.json").write_text("{}")
                            (root / "kpop.db-journal").write_bytes(b"partial")
                        return outcome
                    with patch("scripts.rebuild_database.run_attempt", attempt), redirect_stdout(io.StringIO()):
                        code = rebuild(db, ["collector"], Limits(max_attempts=1), schema_cache=True)
                        if code:
                            self.assertEqual(restore_cache(db, raw, "simulated refresh failure"), 0)
                            self.assertFalse((raw / "partial.json").exists())
                            self.assertFalse((root / "kpop.db-journal").exists())
                            self.assertEqual(rebuild_cache.compatible(db), cache == "same")
                        else:
                            self.assertTrue(rebuild_cache.compatible(db))
                    # Confirmed previous-day history lets the crossword run too.
                    write_record(root / "published", omission_record("2026-11-17", "test fixture: omitted day"))
                    with redirect_stderr(io.StringIO()):
                        result = run_daily_puzzles(database=db, output_dir=root / "published", reference_date="2026-11-18")
                    self.assertEqual(result["reference_date"], "2026-11-18")
                    for game in ("grid", "connections", "name-guess", "word-search", "timeline", "code-groups", "crossword"):
                        artifact = root / "published" / f"{game}.daily.json"
                        self.assertTrue(artifact.is_file(), (game, result))
                    self.assertTrue(any("session.daily" in name for name in result["published_files"]))

    def test_workflow_versions_key_but_keeps_cross_version_fallback(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/daily-puzzles-cron.yml").read_text()
        self.assertIn('version=$(python3 -m kpop_scraping.rebuild_cache)', workflow)
        self.assertIn("key: kpop-db-${{ steps.archive-schema.outputs.version }}-${{ github.run_id }}", workflow)
        self.assertIn("restore-keys: |\n            kpop-db-${{ steps.archive-schema.outputs.version }}-\n            kpop-db-", workflow)
        self.assertIn("            data/kpop.db.schema", workflow)
        self.assertIn("rebuild --schema-cache --database data/kpop.db", workflow)

    def test_reserve_contains_only_public_generation_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / "reserve.db"
            rebuild_cache.install_reserve(db)
            with sqlite3.connect(db) as connection:
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertEqual(tables, set(rebuild_cache.PUBLIC_COLUMNS))
                for table, columns in rebuild_cache.PUBLIC_COLUMNS.items():
                    self.assertEqual([row[1] for row in connection.execute(f"PRAGMA table_info({table})")], columns.split(","))
