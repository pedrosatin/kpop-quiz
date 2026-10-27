"""Cross-date rejection with the real daily runner and natural generation failure."""
import json
import sqlite3
import shutil
import tempfile
import unittest
from pathlib import Path

from tests.test_daily_puzzles_runner import build_test_database
from kpop_scraping.daily_puzzles_runner import run_daily_puzzles, _install_files, _reject_grid_origin
from kpop_scraping.grid_publication import publication, read_publication, write_publication


class GridOriginRejectionTest(unittest.TestCase):
    def test_real_reuse_then_origin_rejection_survives_later_publication(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            root = Path(folder)
            db = root / 'fixture.db'
            connection = build_test_database(db)
            connection.execute("UPDATE facts SET value_time='2010' WHERE predicate='formed_on'")
            connection.execute("UPDATE facts SET valid_to='2026-10-25',valid_to_precision=11 WHERE predicate='has_member'")
            connection.commit()
            connection.close()
            out = root / 'published'
            result = run_daily_puzzles(db, out, reference_date='2026-10-25', ahead=True)
            self.assertTrue(result['next']['grid_reused'])
            old = json.loads((out / 'grid.daily.json').read_text())
            connection = sqlite3.connect(db)
            connection.execute("DELETE FROM fact_evidence WHERE evidence_type='wikipedia_revision'")
            connection.commit()
            connection.close()
            # First promote the reused day. Its CLI outcome still names the old hash.
            promoted = root / 'promoted'
            shutil.copytree(out, promoted)
            unrelated = 'grid-publication.2000-01-01.json'
            for directory in [promoted, promoted / 'next']:
                (directory / unrelated).write_text('{"schema_version":"invalid"}')
            next_connections = (promoted / 'next/connections.daily.json').read_bytes()
            result = run_daily_puzzles(db, promoted, reference_date='2026-10-26')
            self.assertEqual(result['grid_revalidated']['previous_grid_id'], old['grid_id'])
            self.assertIn(old['grid_id'], read_publication(promoted, '2026-10-25')['replaces'])
            self.assertIn(old['grid_id'], read_publication(promoted, '2026-10-26')['replaces'])
            self.assertFalse((promoted / 'grid.daily.json').exists())
            self.assertEqual((promoted / 'connections.daily.json').read_bytes(), next_connections)
            self.assertEqual((promoted / unrelated).read_text(), '{"schema_version":"invalid"}')
            # Reject an artifact from a previous day during new generation too.
            result = run_daily_puzzles(db, out, reference_date='2026-10-26', ahead=True)
            self.assertIsNone(result['grid_id'])
            origin = read_publication(out, '2026-10-25')
            self.assertIsNone(origin['grid_id'])
            self.assertIn(old['grid_id'], origin['replaces'])
            # Rotating/promotion of next cannot erase the rejection ledger.
            _install_files(out / 'next', out, prune=True)
            self.assertEqual(read_publication(out, '2026-10-25'), origin)
            self.assertTrue((out / 'connections.daily.json').exists())

    def test_rejecting_older_identity_preserves_replacement_and_history_on_promotion(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            root = Path(folder)
            next_dir = root / 'next'
            grid = dict(grid_id='a'*64, reference_date='2026-10-25')
            newer = dict(grid_id='c'*64, reference_date='2026-10-25')
            write_publication(root, publication('2026-10-25', newer, rejected_id='b'*64))
            _reject_grid_origin(root, grid)
            expected = read_publication(root, '2026-10-25')
            self.assertEqual(expected['grid_id'], newer['grid_id'])
            self.assertEqual(expected['replaces'], ['a'*64, 'b'*64])
            write_publication(next_dir, publication('2026-10-25', grid))
            _install_files(next_dir, root)
            self.assertEqual(read_publication(root, '2026-10-25'), expected)
            _reject_grid_origin(root, grid)
            self.assertEqual(read_publication(root, '2026-10-25'), expected)
