"""Daily crossword in the runner: durable history, partial publish and promotion."""
from __future__ import annotations

import copy
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import daily_puzzles_cli, web_publish
from kpop_scraping.crossword_daily import validate_published
from kpop_scraping.crossword_daily_repository import digest
from kpop_scraping.crossword_publication import (
    omission_record,
    pilot_record,
    read_record,
    validate_record,
    verify_history,
    write_record,
)
from kpop_scraping.daily_puzzles_runner import MISSING_CROSSWORD_HISTORY, run_daily_puzzles
from kpop_scraping.web_publish import CROSSWORD_DAILY_FILENAME, verify_artifacts

from tests.test_daily_puzzles_runner import build_test_database

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / 'web' / 'public' / 'data' / 'crossword-pilot.json'
DAY, NEXT, AFTER = '2026-09-18', '2026-09-19', '2026-09-20'
EVE = '2026-09-17'


def crossword_database(path: Path) -> None:
    """Runner fixture whose member facts carry publishable statement ids."""
    conn = build_test_database(path)
    conn.execute("""UPDATE facts SET statement_id=(SELECT wikidata_id FROM entities
                    WHERE id=subject_entity_id)||'$'||statement_id WHERE predicate='has_member'""")
    conn.commit()
    conn.close()


def read(directory: Path, name: str = CROSSWORD_DAILY_FILENAME) -> dict:
    return json.loads((directory / name).read_text(encoding='utf-8'))


def run(*args, **kwargs):
    with redirect_stderr(io.StringIO()):
        return run_daily_puzzles(*args, **kwargs)


def verify_cli(directory: Path, *flags: str) -> int:
    with redirect_stdout(io.StringIO()):
        return web_publish.main(['--output-dir', str(directory), '--verify', *flags])


class DailyCrosswordPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.db = self.path / 'kpop.db'
        crossword_database(self.db)
        self.out = self.path / 'data'
        self.out.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def seed_omitted_eve(self):
        write_record(self.out, omission_record(EVE, 'fixture'))

    def test_ready_day_and_next_day_follow_the_durable_history(self):
        self.seed_omitted_eve()
        result = run(self.db, self.out, reference_date=DAY, ahead=True)
        today = read(self.out)
        validate_published(today)
        self.assertEqual(today['status'], 'ready')
        self.assertEqual(today['previous'], dict(state='omitted', date=EVE, qids=[]))
        self.assertEqual(result['crossword_id'], today['dataset_version'])
        record = read_record(self.out, DAY)
        self.assertEqual((record['state'], record['qids']), ('played', today['puzzle']['vocabulary']))

        upcoming = read(self.out / 'next')
        self.assertEqual(upcoming['reference_date'], NEXT)
        self.assertEqual(upcoming['previous'], dict(state='played', date=DAY, qids=record['qids']))
        self.assertFalse(set(upcoming['puzzle']['vocabulary']) & set(record['qids']))
        self.assertEqual(read_record(self.out / 'next', NEXT)['dataset_version'], upcoming['dataset_version'])
        self.assertEqual(verify_cli(self.out, '--require-crossword'), 0)

        # Promotion confirms the prepared day in the main directory and keeps its bytes.
        promoted = run(self.db, self.out, reference_date=NEXT, ahead=True)
        self.assertTrue(promoted['promoted_from_next'])
        self.assertIsNone(promoted['crossword_confirmed'])
        self.assertEqual(read(self.out), upcoming)
        self.assertEqual(read_record(self.out, DAY), record)
        self.assertEqual(read(self.out / 'next')['previous']['qids'], upcoming['puzzle']['vocabulary'])

    def test_same_inputs_publish_the_same_bytes(self):
        other = self.path / 'other'
        other.mkdir()
        for directory in (self.out, other):
            write_record(directory, omission_record(EVE, 'fixture'))
            run(self.db, directory, reference_date=DAY)
        for name in (CROSSWORD_DAILY_FILENAME, f'crossword-publication.{DAY}.json'):
            self.assertEqual((self.out / name).read_bytes(), (other / name).read_bytes())

    def test_missing_history_omits_only_the_crossword_and_drops_an_earlier_board(self):
        self.seed_omitted_eve()
        run(self.db, self.out, reference_date=DAY)
        (self.out / f'crossword-publication.{DAY}.json').unlink()
        # The history exists, but not for the eve of AFTER: never read as empty.
        result = run(self.db, self.out, reference_date=AFTER, ahead=True)
        self.assertFalse((self.out / CROSSWORD_DAILY_FILENAME).exists())
        self.assertIsNone(result['crossword_id'])
        self.assertEqual(result['crossword_skipped'], {'reason': MISSING_CROSSWORD_HISTORY, 'state': 'omitted'})
        self.assertEqual(read_record(self.out, AFTER)['state'], 'omitted')
        for name in ('connections.daily.json', 'code-groups.daily.json', 'timeline.daily.json'):
            self.assertTrue((self.out / name).is_file(), name)
        # A confirmed omission is history: the next day plays again.
        self.assertEqual(read(self.out / 'next')['status'], 'ready')
        self.assertEqual(read(self.out / 'next')['previous'], dict(state='omitted', date=AFTER, qids=[]))
        self.assertEqual(verify_cli(self.out), 0)
        self.assertEqual(verify_cli(self.out, '--require-crossword'), 1)

    def test_exhausted_generator_publishes_an_explicit_omission(self):
        plain = self.path / 'plain.db'
        build_test_database(plain).close()
        self.seed_omitted_eve()
        result = run(plain, self.out, reference_date=DAY)
        artifact = read(self.out)
        self.assertEqual((artifact['status'], artifact['puzzle']), ('omitted', None))
        self.assertIsNone(result['crossword_id'])
        record = read_record(self.out, DAY)
        self.assertEqual((record['state'], record['dataset_version']), ('omitted', artifact['dataset_version']))
        verify_artifacts(self.out, require_grid=False, require_code_groups=False, require_crossword=True)

    def test_first_run_reads_the_pilot_board_as_the_eve(self):
        shutil.copyfile(PILOT, self.out / 'crossword-pilot.json')
        pilot = json.loads(PILOT.read_text(encoding='utf-8'))
        run(self.db, self.out, reference_date=DAY)
        self.assertEqual(read(self.out)['previous'], dict(state='played', date=EVE, qids=pilot['vocabulary']))
        # Once a record exists, the pilot no longer stands for a missing day.
        (self.out / f'crossword-publication.{DAY}.json').unlink()
        write_record(self.out, omission_record('2026-09-01', 'fixture'))
        run(self.db, self.out, reference_date=NEXT)
        self.assertEqual(read_record(self.out, NEXT)['reason'], MISSING_CROSSWORD_HISTORY)

    def test_kept_set_from_before_the_integration_gets_a_pilot_record(self):
        shutil.copyfile(PILOT, self.out / 'crossword-pilot.json')
        run(self.db, self.out, reference_date=DAY)
        # Simulate a set published by the previous runner: no board, no record.
        (self.out / CROSSWORD_DAILY_FILENAME).unlink()
        (self.out / f'crossword-publication.{DAY}.json').unlink()
        result = run(self.db, self.out, reference_date=DAY, ahead=True)
        self.assertTrue(result['already_published'])
        self.assertEqual(result['crossword_confirmed'], {'action': 'recorded', 'state': 'played', 'source': 'pilot'})
        self.assertEqual(result['crossword_skipped'],
                         {'reason': 'set published before the daily crossword', 'state': 'played'})
        pilot = json.loads(PILOT.read_text(encoding='utf-8'))
        self.assertEqual(read(self.out / 'next')['previous']['qids'], pilot['vocabulary'])

    def test_promotion_regenerates_a_board_prepared_from_a_stale_eve(self):
        self.seed_omitted_eve()
        run(self.db, self.out, reference_date=DAY, ahead=True)
        prepared = read(self.out / 'next')
        # DAY is published again after NEXT was prepared, now as an omission.
        (self.out / f'crossword-publication.{EVE}.json').unlink()
        write_record(self.out, omission_record('2026-09-01', 'fixture'))
        run(self.db, self.out, reference_date=DAY, regenerate=True)
        self.assertEqual(read_record(self.out, DAY)['state'], 'omitted')
        result = run(self.db, self.out, reference_date=NEXT)
        self.assertEqual(result['crossword_confirmed']['action'], 'regenerated')
        self.assertEqual(result['crossword_confirmed']['previous_dataset_version'], prepared['dataset_version'])
        promoted = read(self.out)
        self.assertNotEqual(promoted['dataset_version'], prepared['dataset_version'])
        self.assertEqual(promoted['previous'], dict(state='omitted', date=DAY, qids=[]))
        self.assertEqual(read(self.out / 'next'), promoted)
        self.assertEqual(result['crossword_id'], promoted['dataset_version'])
        self.assertEqual(verify_cli(self.out, '--require-crossword'), 0)

    def test_cli_warns_in_github_actions_when_the_crossword_is_omitted(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(['--database', str(self.db), '--output-dir', str(self.out), '--date', DAY])
        self.assertEqual(code, 0)
        self.assertIn(f'::warning title=Daily crossword omitted::Day published without a crossword board '
                      f'({MISSING_CROSSWORD_HISTORY})', stdout.getvalue())

    def test_dry_run_chains_the_next_day_without_writing(self):
        self.seed_omitted_eve()
        result = run(self.db, self.out, reference_date=DAY, ahead=True, dry_run=True)
        self.assertFalse((self.out / CROSSWORD_DAILY_FILENAME).exists())
        self.assertEqual(result['next']['crossword_record']['previous'],
                         dict(state='played', date=DAY, qids=result['crossword_record']['qids']))


class CrosswordPublicationContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        crossword_database(self.path / 'kpop.db')
        write_record(self.path / 'data', omission_record(EVE, 'fixture'))
        run(self.path / 'kpop.db', self.path / 'data', reference_date=DAY, ahead=True)
        self.out = self.path / 'data'
        self.artifact = read(self.out)
        self.record = read_record(self.out, DAY)

    def tearDown(self):
        self.temp.cleanup()

    def test_consecutive_played_days_cannot_share_a_group(self):
        upcoming = read_record(self.out / 'next', NEXT)
        repeated = copy.deepcopy(upcoming)
        repeated['qids'] = sorted(set(self.record['qids'][:1]) | set(upcoming['qids'][1:]))
        repeated['previous'] = None
        repeated['source'] = 'pilot'
        repeated['base_id'] = None
        validate_record(repeated)
        write_record(self.out / 'next', repeated)
        with self.assertRaisesRegex(ValueError, 'repeats a group'):
            verify_history(self.out, self.out / 'next')
        self.assertEqual(verify_cli(self.out), 1)

    def test_published_board_cannot_repeat_the_eve(self):
        tampered = copy.deepcopy(read(self.out / 'next'))
        tampered['previous']['qids'] = sorted(tampered['puzzle']['vocabulary'][:3])
        tampered['dataset_version'] = digest({k: v for k, v in tampered.items() if k != 'dataset_version'})
        with self.assertRaisesRegex(ValueError, 'consecutive group'):
            validate_published(tampered)

    def test_artifact_must_agree_with_its_record(self):
        write_record(self.out, {**self.record, 'qids': self.record['qids'][:-1] if len(self.record['qids']) > 3
                                else self.record['qids'], 'dataset_version': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'disagrees with its publication record'):
            verify_artifacts(self.out, require_grid=False, require_code_groups=False)
        (self.out / f'crossword-publication.{DAY}.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no publication record'):
            verify_artifacts(self.out, require_grid=False, require_code_groups=False)

    def test_record_contract(self):
        validate_record(pilot_record(DAY, json.loads(PILOT.read_text(encoding='utf-8'))))
        for change in [{'reason': None, 'previous': None, 'dataset_version': None, 'state': 'omitted', 'qids': []},
                       {'state': 'omitted'}, {'qids': self.record['qids'][:2]}, {'previous': None},
                       {'source': 'pilot'}, {'reference_date': '2026-02-30'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_record({**self.record, **change})


if __name__ == '__main__':
    unittest.main()
