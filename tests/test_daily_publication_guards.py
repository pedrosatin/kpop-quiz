"""Regression coverage for publication date and history retention."""
import json
import tempfile
import unittest
from pathlib import Path
from kpop_scraping.daily_puzzles_runner import (
    _guard_publication_date, _install_files, keep_or_promote_day,
    publish_daily_puzzles, run_daily_puzzles, CONNECTIONS_DAILY_FILENAME,
)

class PublicationGuardTests(unittest.TestCase):
    def test_past_date_rejected_before_generation_or_promotion(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            artifact = output / CONNECTIONS_DAILY_FILENAME
            artifact.write_text(json.dumps({"reference_date": "2026-11-10"}))
            before = artifact.read_bytes()
            with self.assertRaisesRegex(ValueError, "newer published day"):
                keep_or_promote_day(output, "2026-11-09")
            with self.assertRaisesRegex(ValueError, "newer published day"):
                publish_daily_puzzles(output, {"reference_date": "2026-11-09"})
            database = output / "placeholder.db"
            database.touch()
            with self.assertRaisesRegex(ValueError, "newer published day"):
                run_daily_puzzles(database, output, reference_date="2026-11-09", regenerate=True)
            self.assertEqual(artifact.read_bytes(), before)
            _guard_publication_date(output, "2026-11-10")
            _guard_publication_date(output, "2026-11-12")

    def test_prune_keeps_both_publication_histories_after_skipped_day(self):
        with tempfile.TemporaryDirectory() as folder:
            output, source = Path(folder) / "output", Path(folder) / "source"
            output.mkdir()
            source.mkdir()
            for name in ("grid-publication.2026-11-09.json", "crossword-publication.2026-11-09.json", "stale.json"):
                (output / name).write_text("{}")
            (source / "new.json").write_text("{}")
            _install_files(source, output, prune=True)
            self.assertEqual({p.name for p in output.iterdir()}, {
                "new.json", "grid-publication.2026-11-09.json", "crossword-publication.2026-11-09.json"})
