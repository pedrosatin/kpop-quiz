"""The deploy gate: ``npm --prefix web run artifacts:verify`` and the workflows.

The gate checks ``data/`` and ``data/next/`` and requires every complete
daily game, the grid included. The group code pilot and the crossword stay
under the partial publish policy: validated when present.
"""
from __future__ import annotations

import io
import json
import shlex
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import web_publish
from kpop_scraping.daily_puzzles_runner import _published_day, run_daily_puzzles
from kpop_scraping.daily_set import DAILY_SET_FILENAME, daily_set, note_omission, write_daily_set
from kpop_scraping.grid_publication import filename as grid_publication_filename
from tests.test_daily_puzzles_runner import build_test_database
from tests.test_word_search_schema import plant_repeated_word

ROOT = Path(__file__).parents[1]


def gate_arguments() -> list[str]:
    """Arguments of the npm gate, so the test follows the real command."""
    script = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))["scripts"]["artifacts:verify"]
    command = script.split("&&", 1)[1]
    return shlex.split(command.split("kpop_scraping.web_publish", 1)[1])


def run_gate(data: Path) -> tuple[int, str]:
    args = gate_arguments()
    args[args.index("--output-dir") + 1] = str(data)
    out = io.StringIO()
    with redirect_stdout(out):
        code = web_publish.main(args)
    return code, out.getvalue()


def copy_published(source: Path, target: Path) -> None:
    """Copy a published set without the orphan sessions no manifest names.

    A set published without the quiz has no manifest and keeps no session.
    """
    target.mkdir()
    manifest_path = source / web_publish.MANIFEST_FILENAME
    sessions = set(web_publish.SESSION_SHORTCUT_FILENAMES)
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        sessions |= {item["path"] for item in manifest["sessions"].values()}
    for path in source.iterdir():
        if path.is_dir():
            copy_published(path, target / path.name)
        elif not path.name.startswith("session.") or path.name in sessions:
            shutil.copyfile(path, target / path.name)


class ArtifactsGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._temp = tempfile.TemporaryDirectory()
        base = Path(cls._temp.name)
        cls.database = base / "kpop.db"
        build_test_database(cls.database).close()
        cls.published = base / "published"
        run_daily_puzzles(
            database=cls.database, output_dir=cls.published, reference_date="2026-09-18", ahead=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls._temp.cleanup()

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.data = Path(self._dir.name) / "data"
        shutil.copytree(self.published, self.data)
        self.next = self.data / "next"

    def tearDown(self):
        self._dir.cleanup()

    def gate(self) -> tuple[int, str]:
        return run_gate(self.data)

    def test_gate_requires_the_grid(self):
        self.assertIn("--require-grid", gate_arguments())

    def test_workflows_run_the_same_gate(self):
        args = shlex.join(gate_arguments())
        for workflow in ("pages.yml", "staging.yml"):
            text = (ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
            self.assertIn(f"python -m kpop_scraping.web_publish {args}", text, workflow)

    def test_complete_day_and_next_day_pass(self):
        self.assertTrue((self.next / web_publish.MANIFEST_FILENAME).is_file())
        code, output = self.gate()
        self.assertEqual(code, 0, output)

    def test_invalid_artifact_in_next_fails_with_its_path(self):
        path = self.next / web_publish.TIMELINE_DAILY_FILENAME
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["events"] = []
        path.write_text(json.dumps(payload), encoding="utf-8")
        code, output = self.gate()
        self.assertEqual(code, 1)
        self.assertIn(str(path), output)

    def test_word_repeated_in_the_word_search_grid_fails_in_either_directory(self):
        for directory in (self.data, self.next):
            for reverse in (False, True):
                with self.subTest(directory=directory.name, reverse=reverse):
                    path = directory / web_publish.WORD_SEARCH_DAILY_FILENAME
                    saved = path.read_bytes()
                    payload = json.loads(saved)
                    plant_repeated_word(payload, reverse=reverse)
                    path.write_text(json.dumps(payload), encoding="utf-8")
                    code, output = self.gate()
                    self.assertEqual(code, 1)
                    self.assertIn(str(path), output)
                    self.assertIn("appears in the grid outside its declared coordinates", output)
                    path.write_bytes(saved)

    def test_missing_grid_fails_in_either_directory(self):
        for directory in (self.data, self.next):
            with self.subTest(directory=directory.name):
                grid = directory / web_publish.GRID_DAILY_FILENAME
                saved = grid.read_bytes()
                grid.unlink()
                code, output = self.gate()
                self.assertEqual(code, 1)
                self.assertIn(f"missing required grid artifact: {grid}", output)
                grid.write_bytes(saved)

    def test_grid_omitted_by_the_publication_record_passes(self):
        # The runner publishes a day without a grid when generation fails and
        # no previous grid is valid; the day's record then has grid_id null.
        connections = json.loads((self.data / web_publish.CONNECTIONS_DAILY_FILENAME).read_text(encoding="utf-8"))
        record = self.data / grid_publication_filename(connections["reference_date"])
        value = json.loads(record.read_text(encoding="utf-8"))
        (self.data / web_publish.GRID_DAILY_FILENAME).unlink()
        record.write_text(json.dumps({**value, "grid_id": None, "grid_reference_date": None}), encoding="utf-8")
        self.assertEqual(self.gate()[0], 0)

    def test_days_the_runner_publishes_without_a_grid_pass(self):
        # grid_skipped: generation fails and no previous grid exists, so the
        # day and the next one go out without grid.daily.json.
        output = Path(self._dir.name) / "gridless"
        with patch(
            "kpop_scraping.daily_puzzles_runner.generate_daily_grid",
            side_effect=ValueError("Unable to generate a solvable 3x3 intersection grid"),
        ):
            result = run_daily_puzzles(
                database=self.database, output_dir=output, reference_date="2026-09-18", ahead=True,
            )
        self.assertIsNotNone(result["grid_skipped"])
        self.assertIsNotNone(result["next"]["grid_skipped"])
        self.assertFalse((output / web_publish.GRID_DAILY_FILENAME).exists())
        self.assertFalse((output / "next" / web_publish.GRID_DAILY_FILENAME).exists())
        code, output_text = run_gate(output)
        self.assertEqual(code, 0, output_text)

    def test_missing_next_directory_passes(self):
        shutil.rmtree(self.next)
        code, output = self.gate()
        self.assertEqual(code, 0, output)


# Files of each game the partial publish policy may leave out of a day.
GAME_FILES = {
    "quiz": (
        web_publish.MANIFEST_FILENAME, web_publish.ENRICHED_MANIFEST_FILENAME,
        *web_publish.SESSION_SHORTCUT_FILENAMES,
    ),
    **{game: (name,) for game, name in web_publish.DAILY_GAME_FILES.items() if game != "quiz"},
}


def omit_game(directory: Path, game: str) -> None:
    """Leave ``game`` out of the set in ``directory``, as the runner would."""
    if not (directory / DAILY_SET_FILENAME).is_file():
        # A set published before the record: the runner dates it by its
        # connections board.
        day = _published_day(directory)
        write_daily_set(directory, daily_set(day, {}))
    for name in GAME_FILES[game]:
        (directory / name).unlink(missing_ok=True)
    note_omission(directory, game, "left out for the test")


class PartialDayGateTests(unittest.TestCase):
    """The deploy gate accepts a day without any one of its games."""

    @classmethod
    def setUpClass(cls):
        cls._temp = tempfile.TemporaryDirectory()
        base = Path(cls._temp.name)
        database = base / "kpop.db"
        build_test_database(database).close()
        cls.generated = base / "generated"
        run_daily_puzzles(database=database, output_dir=cls.generated, reference_date="2026-09-18", ahead=True)

    @classmethod
    def tearDownClass(cls):
        cls._temp.cleanup()

    def assert_gate_accepts_each_omitted_game(self, source: Path) -> None:
        for game in GAME_FILES:
            with self.subTest(game=game), tempfile.TemporaryDirectory() as directory:
                data = Path(directory) / "data"
                copy_published(source, data)
                for folder in (data, data / "next"):
                    if folder.is_dir():
                        omit_game(folder, game)
                code, output = run_gate(data)
                self.assertEqual(code, 0, output)
                self.assertIn(f"omits {game}: left out for the test", output)

    def test_runner_set_without_each_game_passes(self):
        self.assert_gate_accepts_each_omitted_game(self.generated)

    def test_checked_in_set_without_each_game_passes(self):
        self.assert_gate_accepts_each_omitted_game(ROOT / "web" / "public" / "data")

    def test_a_required_game_removed_without_the_record_still_fails(self):
        for game in ("quiz", "connections", "name-guess", "word-search", "timeline"):
            with self.subTest(game=game), tempfile.TemporaryDirectory() as directory:
                data = Path(directory) / "data"
                copy_published(self.generated, data)
                for name in GAME_FILES[game]:
                    (data / name).unlink(missing_ok=True)
                code, output = run_gate(data)
                self.assertEqual(code, 1, output)


class CheckedInDataGateTests(unittest.TestCase):
    """The checked-in set carries the group code pilot and the crossword."""

    def test_missing_code_groups_and_crossword_pass(self):
        partial = (web_publish.CODE_GROUPS_DAILY_FILENAME, web_publish.CROSSWORD_DAILY_FILENAME)
        source = ROOT / "web" / "public" / "data"
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            copy_published(source, data)
            self.assertEqual(run_gate(data)[0], 0)
            removed = [
                path for folder in (data, data / "next") for name in partial
                if (path := folder / name).is_file()
            ]
            if not removed:
                self.skipTest("the checked-in set has no group code or crossword artifact")
            for path in removed:
                path.unlink()
            code, output = run_gate(data)
            self.assertEqual(code, 0, output)


if __name__ == "__main__":
    unittest.main()
