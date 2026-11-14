"""Partial publication: a game that fails is left out of its day alone."""

from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping import daily_puzzles_cli, daily_puzzles_runner, web_publish
from kpop_scraping.board_swap_gate import check_board_swaps
from kpop_scraping.daily_puzzles_runner import (
    NEXT_DIRNAME,
    NoGamePublishedError,
    _published_day,
    run_daily_puzzles,
)
from kpop_scraping.daily_set import (
    DAILY_SET_FILENAME,
    MAX_REASON_LENGTH,
    daily_set,
    omission_reason,
    public_omission_reason,
    read_daily_set,
    validate_daily_set,
    write_daily_set,
)
from kpop_scraping.web_publish import DAILY_GAME_FILES, verify_artifacts
from tests.test_board_swap_gate import commit_data, init_repo
from tests.test_daily_puzzles_runner import build_test_database

DAY, NEXT_DAY, AFTER = "2026-09-18", "2026-09-19", "2026-09-20"
BUDGET_ERROR = (
    "connections search exhausted its budget of 10000 steps without a board "
    "whose partition is unique"
)
# Flags the cron's "Verify published artifacts" step passes (web/package.json).
CRON_VERIFY_FLAGS = [
    "--require-grid", "--require-connections", "--require-name-guess",
    "--require-word-search", "--require-timeline",
]
STRICT = dict(
    require_grid=True, require_connections=True, require_name_guess=True,
    require_word_search=True, require_timeline=True,
)
GAME_FILES = {
    game: name for game, name in DAILY_GAME_FILES.items() if game != "crossword"
}


def failing_on(games: set[str], dates: set[str], error: BaseException):
    """Make the isolated generator of ``games`` raise ``error`` on ``dates``."""
    real = daily_puzzles_runner._isolated

    def isolated(game, iso_date, produce):
        if game in games and iso_date in dates:
            def produce():
                raise error
        return real(game, iso_date, produce)

    return patch.object(daily_puzzles_runner, "_isolated", side_effect=isolated)


def failing_crossword_on(dates: set[str]):
    real = daily_puzzles_runner.generate_daily_crossword

    def generate(base, iso_date, seed, previous):
        if iso_date in dates:
            raise MemoryError()
        return real(base, iso_date, seed, previous)

    return patch.object(daily_puzzles_runner, "generate_daily_crossword", side_effect=generate)


class PartialPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "kpop.db"
        build_test_database(self.db_path).close()
        self.out = self.root / "data"

    def tearDown(self):
        self.temp.cleanup()

    def assert_published(self, directory: Path, day: str, absent: str) -> None:
        for game, name in GAME_FILES.items():
            path = directory / name
            if game == absent:
                self.assertFalse(path.exists(), f"{name} should be omitted")
            else:
                self.assertTrue(path.is_file(), f"{name} should be published")
        record = read_daily_set(directory)
        self.assertEqual(record["reference_date"], day)
        self.assertIn(absent, record["omitted"])
        verify_artifacts(directory, **STRICT)

    def cron_verify(self) -> int:
        with redirect_stdout(io.StringIO()):
            return web_publish.main(["--output-dir", str(self.out), "--verify", *CRON_VERIFY_FLAGS])

    def test_connections_error_publishes_the_other_games_of_both_days(self):
        with failing_on({"connections"}, {DAY, NEXT_DAY}, ValueError(BUDGET_ERROR)):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True
            )

        self.assert_published(self.out, DAY, "connections")
        self.assert_published(self.out / NEXT_DIRNAME, NEXT_DAY, "connections")
        self.assertEqual(result["connections_skipped"], {"error": BUDGET_ERROR})
        self.assertEqual(result["next"]["connections_skipped"], {"error": BUDGET_ERROR})
        self.assertIsNone(result["connections_id"])
        self.assertIsNone(result["name_guess_skipped"])
        # The public record names the failure; the full reason stays in the result.
        self.assertEqual(read_daily_set(self.out)["omitted"]["connections"], "generation failed (ValueError)")
        self.assertEqual(self.cron_verify(), 0)

    def test_memory_error_in_the_quiz_publishes_the_other_games_of_both_days(self):
        with failing_on({"quiz"}, {DAY, NEXT_DAY}, MemoryError()):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True,
                catalog=True,
            )

        for directory, day in ((self.out, DAY), (self.out / NEXT_DIRNAME, NEXT_DAY)):
            self.assert_published(directory, day, "quiz")
            for name in ("manifest-v3.json", "session.pt-BR.json", "session.en.json"):
                self.assertFalse((directory / name).exists())
        self.assertEqual(result["quiz_skipped"], {"error": "MemoryError"})
        self.assertIsNone(result["dataset_version"])
        # The catalog builds its own dataset when no day has one, and a day
        # without the quiz still verifies the catalog on its own.
        self.assertNotIn("catalog_skipped", result)
        self.assertTrue((self.out / "catalog-manifest-v1.json").is_file())
        self.assertEqual(self.cron_verify(), 0)

    def test_catalog_failure_withdraws_the_catalog_and_keeps_the_day(self):
        with patch.object(daily_puzzles_runner, "build_catalog", side_effect=MemoryError()):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, catalog=True
            )
        self.assertEqual(result["catalog_skipped"], {"error": "MemoryError"})
        self.assertIsNone(result["catalog"])
        self.assertFalse((self.out / "catalog-manifest-v1.json").exists())
        self.assertTrue((self.out / "manifest-v2.json").is_file())
        self.assertEqual(self.cron_verify(), 0)

    def test_failure_of_every_next_day_game_still_installs_the_day(self):
        with failing_on(set(GAME_FILES), {NEXT_DAY}, MemoryError()), failing_crossword_on({NEXT_DAY}):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True
            )

        self.assertNotIn("next", result)
        self.assertEqual(result["next_skipped"]["reference_date"], NEXT_DAY)
        self.assertIn("No game could be generated", result["next_skipped"]["error"])
        for name in GAME_FILES.values():
            self.assertTrue((self.out / name).is_file())
        self.assertEqual(_published_day(self.out), DAY)
        self.assertFalse((self.out / NEXT_DIRNAME / "manifest-v2.json").exists())
        self.assertEqual(self.cron_verify(), 0)

    def test_one_next_day_game_failing_leaves_the_day_complete(self):
        with failing_on({"timeline"}, {NEXT_DAY}, RuntimeError("boom")):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True
            )

        self.assertEqual(read_daily_set(self.out)["omitted"].get("timeline"), None)
        self.assertIsNone(result["timeline_skipped"])
        self.assertEqual(result["next"]["timeline_skipped"], {"error": "RuntimeError: boom"})
        self.assert_published(self.out / NEXT_DIRNAME, NEXT_DAY, "timeline")

    def test_failure_of_every_game_of_the_day_fails_the_run_and_installs_nothing(self):
        stderr = io.StringIO()
        with failing_on(set(GAME_FILES), {DAY}, ValueError("no facts")), redirect_stderr(stderr):
            with self.assertRaises(NoGamePublishedError):
                run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY)
            code = daily_puzzles_cli.main(
                ["--database", str(self.db_path), "--output-dir", str(self.out), "--date", DAY]
            )
        self.assertEqual(code, 1)
        self.assertIn("No game could be generated for 2026-09-18", stderr.getvalue())
        self.assertFalse(self.out.exists() and any(self.out.iterdir()))

    def test_promoted_day_without_a_game_keeps_its_date_and_its_boards(self):
        repo = self.root / "repo"
        repo.mkdir()
        init_repo(repo)
        out = repo / "data"
        with failing_on({"connections"}, {NEXT_DAY}, ValueError(BUDGET_ERROR)):
            run_daily_puzzles(
                database=self.db_path, output_dir=out, reference_date=DAY, ahead=True
            )
        self.assertTrue((out / "connections.daily.json").is_file())
        commit_data(repo)
        next_ids = {
            name: json.loads((out / NEXT_DIRNAME / name).read_text())["puzzle_id"]
            for name in ("name-guess.daily.json", "timeline.daily.json")
        }

        promoted = run_daily_puzzles(
            database=self.db_path, output_dir=out, reference_date=NEXT_DAY, ahead=True
        )

        self.assertTrue(promoted["promoted_from_next"])
        # The day's own connections board never came; the one of the day
        # before does not stand in for it.
        self.assertFalse((out / "connections.daily.json").exists())
        self.assertEqual(
            promoted["connections_skipped"],
            {"error": "generation failed (ValueError)", "published_without": True},
        )
        self.assertEqual(promoted["connections_partition"]["reason"], "no connections board")
        self.assertEqual(_published_day(out), NEXT_DAY)
        for name, puzzle_id in next_ids.items():
            self.assertEqual(json.loads((out / name).read_text())["puzzle_id"], puzzle_id)
        # The next day is generated whole, with its crossword history intact.
        self.assertTrue((out / NEXT_DIRNAME / "connections.daily.json").is_file())
        self.assertEqual(read_daily_set(out / NEXT_DIRNAME)["reference_date"], AFTER)
        self.assertEqual(self.cron_verify_dir(out), 0)

        # The gate still knows the day and compares the boards it publishes.
        self.assertEqual(
            check_board_swaps(repo, "data", "HEAD", {"regenerate": False, "swaps": []}), ([], [])
        )
        commit_data(repo)
        kept = run_daily_puzzles(database=self.db_path, output_dir=out, reference_date=NEXT_DAY)
        self.assertTrue(kept["already_published"])
        self.assertFalse((out / "connections.daily.json").exists())
        swapped = json.loads((out / "timeline.daily.json").read_text())
        swapped["puzzle_id"] = "f" * 64
        (out / "timeline.daily.json").write_text(json.dumps(swapped))
        refused = check_board_swaps(repo, "data", "HEAD", {"regenerate": False, "swaps": []})[1]
        self.assertEqual(len(refused), 1)
        self.assertIn(f"timeline for {NEXT_DAY}", refused[0])

    def cron_verify_dir(self, directory: Path) -> int:
        with redirect_stdout(io.StringIO()):
            return web_publish.main(["--output-dir", str(directory), "--verify", *CRON_VERIFY_FLAGS])

    def test_cli_warns_once_per_skipped_game_with_an_escaped_reason(self):
        reason = "bad label 100%\n::add-mask::secret\r\nend"
        stdout, stderr = io.StringIO(), io.StringIO()
        with failing_on({"name-guess"}, {DAY}, ValueError(reason)), patch.dict(
            os.environ, {"GITHUB_ACTIONS": "true"}
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            code = daily_puzzles_cli.main(
                ["--database", str(self.db_path), "--output-dir", str(self.out), "--date", DAY]
            )
        self.assertEqual(code, 0)
        warnings = [
            line for line in stdout.getvalue().splitlines()
            if line.startswith("::warning title=Daily name guess")
        ]
        self.assertEqual(
            warnings,
            [
                "::warning title=Daily name guess missing::Day 2026-09-18 published without "
                "name-guess.daily.json because generation failed: "
                "bad label 100%25 ::add-mask::secret end"
            ],
        )
        self.assertFalse(any(line.startswith("::") for line in stderr.getvalue().splitlines()))


class NextDayFailureTests(unittest.TestCase):
    """A failure of the next day, of any kind, leaves the installed day alone."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "kpop.db"
        build_test_database(self.db_path).close()
        self.out = self.root / "data"

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, *extra: str) -> tuple[int, str]:
        stderr = io.StringIO()
        with redirect_stderr(stderr), redirect_stdout(io.StringIO()):
            code = daily_puzzles_cli.main([
                "--database", str(self.db_path), "--output-dir", str(self.out), "--date", DAY, *extra,
            ])
        return code, stderr.getvalue()

    def snapshot(self, directory: Path) -> dict[str, bytes]:
        return {path.name: path.read_bytes() for path in sorted(directory.glob("*.json"))}

    def assert_day_installed(self) -> None:
        self.assertEqual(_published_day(self.out), DAY)
        verify_artifacts(self.out, **STRICT)

    def test_generation_error_of_the_next_day(self):
        real = daily_puzzles_runner.generate_daily_puzzles

        def generate(connection, reference_date=None, **kwargs):
            if reference_date == NEXT_DAY:
                raise RuntimeError("next day exploded")
            return real(connection, reference_date=reference_date, **kwargs)

        with patch.object(daily_puzzles_runner, "generate_daily_puzzles", side_effect=generate):
            code, stderr = self.run_cli("--ahead")
        self.assertEqual(code, 0, stderr)
        self.assert_day_installed()
        self.assertFalse((self.out / NEXT_DIRNAME).exists())
        self.assertIn("Next day 2026-09-19 not published ahead: RuntimeError: next day exploded", stderr)

    def test_os_error_installing_the_next_day_keeps_both_sets(self):
        run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True)
        day, ahead = self.snapshot(self.out), self.snapshot(self.out / NEXT_DIRNAME)
        real = daily_puzzles_runner._install_files

        def install(source, output_dir, prune=False):
            if Path(output_dir).name == NEXT_DIRNAME:
                raise OSError("No space left on device")
            return real(source, output_dir, prune=prune)

        with patch.object(daily_puzzles_runner, "_install_files", side_effect=install):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True
            )
        self.assertTrue(result["already_published"])
        self.assertEqual(result["next_skipped"]["error"], "OSError: No space left on device")
        self.assertNotIn("next", result)
        self.assertEqual(self.snapshot(self.out), day)
        self.assertEqual(self.snapshot(self.out / NEXT_DIRNAME), ahead)

    def test_next_day_that_fails_verification_after_install_is_removed(self):
        with patch.object(
            daily_puzzles_runner, "verify_crossword_history", side_effect=ValueError("history broken")
        ):
            result = run_daily_puzzles(
                database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True
            )
        self.assertEqual(result["next_skipped"]["error"], "history broken")
        self.assertFalse((self.out / NEXT_DIRNAME).exists())
        self.assert_day_installed()

    def test_unreadable_next_record_is_rebuilt(self):
        run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True)
        (self.out / NEXT_DIRNAME / DAILY_SET_FILENAME).write_text("{", encoding="utf-8")
        code, stderr = self.run_cli("--ahead")
        self.assertEqual(code, 0, stderr)
        self.assertIn("treating", stderr)
        self.assertEqual(read_daily_set(self.out / NEXT_DIRNAME)["reference_date"], NEXT_DAY)
        verify_artifacts(self.out / NEXT_DIRNAME, **STRICT)

    def test_unreadable_next_record_is_not_promoted(self):
        run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True)
        (self.out / NEXT_DIRNAME / DAILY_SET_FILENAME).write_text("{", encoding="utf-8")
        with redirect_stderr(io.StringIO()):
            result = run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=NEXT_DAY)
        self.assertNotIn("promoted_from_next", result)
        self.assertEqual(_published_day(self.out), NEXT_DAY)

    def test_unreadable_main_record_fails_closed(self):
        run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY)
        (self.out / DAILY_SET_FILENAME).write_text("{", encoding="utf-8")
        before = self.snapshot(self.out)
        code, stderr = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn(f"cannot read daily set {self.out / DAILY_SET_FILENAME}", stderr)
        self.assertEqual(self.snapshot(self.out), before)

    def test_legacy_next_set_without_a_record_is_promoted(self):
        # The first run after this change promotes a next/ set published
        # before daily-set.json existed.
        run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=DAY, ahead=True)
        (self.out / NEXT_DIRNAME / DAILY_SET_FILENAME).unlink()
        promoted = run_daily_puzzles(
            database=self.db_path, output_dir=self.out, reference_date=NEXT_DAY, ahead=True
        )
        self.assertTrue(promoted["promoted_from_next"])
        # The record of the day before does not survive the promotion: the
        # promoted set is dated by its connections board.
        self.assertFalse((self.out / DAILY_SET_FILENAME).exists())
        self.assertEqual(_published_day(self.out), NEXT_DAY)
        verify_artifacts(self.out, **STRICT)
        self.assertEqual(read_daily_set(self.out / NEXT_DIRNAME)["reference_date"], AFTER)
        kept = run_daily_puzzles(database=self.db_path, output_dir=self.out, reference_date=NEXT_DAY)
        self.assertTrue(kept["already_published"])


class PublicReasonTests(unittest.TestCase):
    """daily-set.json is public: it never carries an exception's message."""

    def test_a_local_path_in_an_error_stays_out_of_the_public_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db_path = root / "kpop.db"
            build_test_database(db_path).close()
            out = root / "data"
            leak = OSError("cannot open /home/someone/private/kpop.db")
            with failing_on({"timeline"}, {DAY}, leak), failing_crossword_on({NEXT_DAY}), redirect_stderr(io.StringIO()):
                result = run_daily_puzzles(database=db_path, output_dir=out, reference_date=DAY, ahead=True)
            published = "".join(path.read_text() for path in out.rglob("*.json"))
            self.assertNotIn("/home/someone", published)
            self.assertEqual(read_daily_set(out)["omitted"]["timeline"], "generation failed (OSError)")
            self.assertEqual(read_daily_set(out / NEXT_DIRNAME)["omitted"]["crossword"], "generation failed (MemoryError)")
            # The run's own result keeps the full reason for the log.
            self.assertEqual(
                result["timeline_skipped"]["error"], "OSError: cannot open /home/someone/private/kpop.db"
            )

    def test_public_reason_names_only_the_type(self):
        self.assertEqual(public_omission_reason(ValueError("Q1 /tmp/x")), "generation failed (ValueError)")
        self.assertEqual(public_omission_reason(MemoryError()), "generation failed (MemoryError)")


class DailySetVerificationTests(unittest.TestCase):
    """The record explains an absence; it never hides a published file."""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        db_path = root / "kpop.db"
        build_test_database(db_path).close()
        cls.source = root / "source"
        with failing_on({"word-search"}, {DAY}, ValueError("no theme")):
            run_daily_puzzles(database=db_path, output_dir=cls.source, reference_date=DAY)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.out = Path(self.work.name) / "data"
        shutil.copytree(self.source, self.out)

    def tearDown(self):
        self.work.cleanup()

    def test_partial_day_verifies_strictly(self):
        verify_artifacts(self.out, **STRICT)

    def test_a_required_game_missing_from_the_record_fails(self):
        write_daily_set(self.out, daily_set(DAY, {}))
        with self.assertRaisesRegex(ValueError, "missing required word-search artifact"):
            verify_artifacts(self.out, **STRICT)

    def test_a_game_listed_as_omitted_must_have_no_file(self):
        write_daily_set(self.out, daily_set(DAY, {"word-search": "x", "timeline": "y"}))
        with self.assertRaisesRegex(ValueError, "timeline.daily.json is published, but daily-set.json omits timeline"):
            verify_artifacts(self.out, **STRICT)

    def test_an_artifact_of_another_day_fails(self):
        write_daily_set(self.out, daily_set(NEXT_DAY, read_daily_set(self.out)["omitted"]))
        with self.assertRaisesRegex(ValueError, "is for 2026-09-18, but daily-set.json publishes 2026-09-19"):
            verify_artifacts(self.out, **STRICT)

    def test_a_quiz_session_of_another_day_fails(self):
        path = self.out / "session.en.json"
        session = json.loads(path.read_text(encoding="utf-8"))
        session["config"]["seed"] = "kpop-daily-2026-09-17"
        path.write_text(json.dumps(session), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "session.en.json is for 2026-09-17, but daily-set.json publishes 2026-09-18"):
            verify_artifacts(self.out, **STRICT)

    def test_daily_quiz_sessions_are_dated_by_their_seed(self):
        manifest = json.loads((self.out / "manifest-v2.json").read_text(encoding="utf-8"))
        daily = [key for key in manifest["sessions"] if key.startswith("daily.")]
        self.assertTrue(daily)
        for key in daily:
            session = json.loads((self.out / manifest["sessions"][key]["path"]).read_text(encoding="utf-8"))
            self.assertEqual(web_publish._daily_session_date(session), DAY, key)
        write_daily_set(self.out, daily_set(NEXT_DAY, {"word-search": "x", "connections": "x",
            "name-guess": "x", "timeline": "x", "code-groups": "x", "crossword": "x"}))
        for name in ("connections.daily.json", "name-guess.daily.json", "timeline.daily.json",
                     "code-groups.daily.json", "crossword.daily.json"):
            (self.out / name).unlink(missing_ok=True)
        (self.out / "session.en.json").unlink()
        (self.out / "session.pt-BR.json").unlink()
        with self.assertRaisesRegex(ValueError, "quiz session daily.* is for 2026-09-18, but daily-set.json publishes 2026-09-19"):
            verify_artifacts(self.out, require_grid=False)

    def test_a_set_without_the_record_keeps_the_strict_rules(self):
        (self.out / DAILY_SET_FILENAME).unlink()
        with self.assertRaisesRegex(ValueError, "missing required word-search artifact"):
            verify_artifacts(self.out, **STRICT)

    def test_record_rejects_unknown_games_unsafe_reasons_and_an_empty_day(self):
        with self.assertRaisesRegex(ValueError, "unknown game"):
            validate_daily_set({
                "schema_version": "kpop-daily-set-v1", "reference_date": DAY,
                "omitted": {"chess": "x"},
            })
        with self.assertRaisesRegex(ValueError, "invalid omission reason"):
            daily_set(DAY, {"quiz": "line\n::error::x"})
        with self.assertRaisesRegex(ValueError, "omits every game"):
            daily_set(DAY, {game: "x" for game in DAILY_GAME_FILES})


class OmissionReasonTests(unittest.TestCase):
    def test_reason_is_one_bounded_line_named_by_type_outside_value_errors(self):
        self.assertEqual(omission_reason(ValueError("no board")), "no board")
        self.assertEqual(omission_reason(MemoryError()), "MemoryError")
        self.assertEqual(omission_reason(KeyError("qid")), "KeyError: 'qid'")
        self.assertEqual(omission_reason(ValueError("a\r\n::warning::b\x1b")), "a ::warning::b")
        long = omission_reason(ValueError("x" * 5000))
        self.assertEqual(len(long), MAX_REASON_LENGTH)

    def test_cancellation_is_not_swallowed(self):
        for error in (KeyboardInterrupt(), SystemExit(3)):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)):
                daily_puzzles_runner._isolated("quiz", DAY, lambda: (_ for _ in ()).throw(error))


if __name__ == "__main__":
    unittest.main()
