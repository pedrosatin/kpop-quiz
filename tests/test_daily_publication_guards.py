"""Regression coverage for publication date and history retention."""
import json
import tempfile
import unittest
import os
from unittest.mock import patch
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

    def test_failed_directory_swap_restores_complete_old_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            output, source = Path(folder) / "output", Path(folder) / "source"
            output.mkdir()
            source.mkdir()
            (output / "a.json").write_text("old")
            (output / "b.json").write_text("old")
            (source / "a.json").write_text("new")
            (source / "b.json").write_text("new")
            original = os.replace
            def replace(src, dst):
                if Path(src).name == "snapshot":
                    raise OSError("interrupted swap")
                return original(src, dst)
            with patch("kpop_scraping.daily_puzzles_runner.os.replace", side_effect=replace):
                with self.assertRaises(OSError):
                    _install_files(source, output)
            self.assertEqual((output / "a.json").read_text(), "old")
            self.assertEqual((output / "b.json").read_text(), "old")

    def test_next_read_recovers_directory_after_process_died_in_swap_gap(self):
        from kpop_scraping.daily_puzzles_runner import _published_day
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "output"
            backup = output.with_name(".output.publication-backup")
            backup.mkdir()
            (backup / CONNECTIONS_DAILY_FILENAME).write_text(json.dumps({"reference_date": "2026-11-10"}))
            self.assertEqual(_published_day(output), "2026-11-10")
            self.assertTrue(output.is_dir())
            self.assertFalse(backup.exists())

    def test_crossword_replacement_archives_previous_record(self):
        from kpop_scraping.crossword_publication import omission_record, write_record, read_record
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            old = omission_record("2026-11-10", "first reason")
            new = omission_record("2026-11-10", "second reason")
            write_record(directory, old)
            write_record(directory, new)
            write_record(directory, new)
            archives = list(directory.glob("crossword-history.*.json"))
            self.assertEqual(len(archives), 1)
            self.assertEqual(json.loads(archives[0].read_text()), old)
            self.assertEqual(read_record(directory, "2026-11-10"), new)
