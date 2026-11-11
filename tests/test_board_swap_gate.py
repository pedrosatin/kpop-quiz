"""Board swap gate: a published day keeps its boards unless the swap is declared."""

from __future__ import annotations

import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kpop_scraping.board_swap_gate import check_board_swaps, main

DAY, EVE = "2026-10-19", "2026-10-18"
GAMES = {
    "quiz": "q1", "grid": "g1", "connections": "c1", "name-guess": "n1",
    "word-search": "w1", "timeline": "t1", "code-groups": "k1", "crossword": "x1",
}


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
         "-c", "commit.gpgsign=false", *args],
        cwd=repo, check=True, capture_output=True,
    )


def init_repo(repo: Path) -> None:
    git(repo, "init", "-q")
    git(repo, "commit", "-q", "--allow-empty", "-m", "base")


def commit_data(repo: Path) -> None:
    git(repo, "add", "-A", "data")
    git(repo, "commit", "-q", "--allow-empty", "-m", "publish")


def write_set(directory: Path, day: str, **changes: str | None) -> None:
    """Write the boards of one set; a game set to None has no file."""
    boards = {**GAMES, **{game.replace("_", "-"): value for game, value in changes.items()}}
    puzzle = lambda game: {"reference_date": day, "puzzle_id": boards[game]}  # noqa: E731
    files = {
        "quiz": ("manifest-v2.json", {"sessions": {
            "daily.en.standard": {"session_id": boards["quiz"]},
            "en.standard": {"session_id": "base-session"},
        }}),
        "grid": ("grid.daily.json", {"reference_date": day, "grid_id": boards["grid"]}),
        "connections": ("connections.daily.json", puzzle("connections")),
        "name-guess": ("name-guess.daily.json", puzzle("name-guess")),
        "word-search": ("word-search.daily.json", puzzle("word-search")),
        "timeline": ("timeline.daily.json", puzzle("timeline")),
        "code-groups": ("code-groups.daily.json", puzzle("code-groups")),
        "crossword": ("crossword.daily.json", {
            "reference_date": day, "status": "ready", "dataset_version": boards["crossword"],
        }),
    }
    directory.mkdir(parents=True, exist_ok=True)
    for game, (name, payload) in files.items():
        if boards[game] is None:
            (directory / name).unlink(missing_ok=True)
        else:
            (directory / name).write_text(json.dumps(payload), encoding="utf-8")


def declaration(*swaps: tuple[str, str], regenerate: bool = False) -> dict:
    return {
        "regenerate": regenerate,
        "swaps": [{"game": game, "date": day, "reason": "fixture"} for game, day in swaps],
    }


class BoardSwapGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.data = self.repo / "data"
        init_repo(self.repo)

    def tearDown(self):
        self.temp.cleanup()

    def check(self, swaps: dict) -> tuple[list[str], list[str]]:
        return check_board_swaps(self.repo, "data", "HEAD", swaps)

    def publish_base(self, day: str = DAY, **changes: str | None) -> None:
        write_set(self.data, day, **changes)
        commit_data(self.repo)

    def test_an_undeclared_swap_fails_with_the_game_and_the_date(self):
        self.publish_base()
        write_set(self.data, DAY, connections="c2", grid="g2")
        swaps = self.repo / "swaps.json"
        swaps.write_text(json.dumps(declaration()), encoding="utf-8")
        stdout, stderr = io.StringIO(), io.StringIO()

        with patch("pathlib.Path.cwd", return_value=self.repo), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(["--data-dir", "data", "--board-swaps-file", str(swaps)])

        self.assertEqual(code, 1)
        self.assertIn("connections for 2026-10-19", stderr.getvalue())
        self.assertIn("grid for 2026-10-19", stderr.getvalue())
        self.assertNotIn("name-guess", stderr.getvalue())
        self.assertEqual(stdout.getvalue(), "")

    def test_regenerate_accepts_the_swap_and_logs_it(self):
        self.publish_base()
        write_set(self.data, DAY, connections="c2")

        accepted, refused = self.check(declaration(regenerate=True))

        self.assertEqual(refused, [])
        self.assertEqual(len(accepted), 1)
        self.assertIn("connections for 2026-10-19", accepted[0])
        self.assertIn("--regenerate", accepted[0])

    def test_a_swap_declared_by_the_runner_passes_only_for_that_game_and_date(self):
        self.publish_base()
        write_set(self.data, DAY, grid="g2", timeline="t2")

        accepted, refused = self.check(declaration(("grid", DAY), ("timeline", EVE)))

        self.assertEqual([line.split(" for ")[0] for line in accepted], ["grid"])
        self.assertIn("declared by the runner", accepted[0])
        self.assertEqual([line.split(" for ")[0] for line in refused], ["timeline"])

    def test_a_crossword_replaced_on_promotion_is_checked_against_next(self):
        self.publish_base(EVE)
        write_set(self.data / "next", DAY)
        commit_data(self.repo)
        # The promotion installs next/ of DAY in the main directory, with a new crossword.
        write_set(self.data, DAY, crossword="x2")

        self.assertEqual(self.check(declaration())[0], [])
        refused = self.check(declaration())[1]
        self.assertEqual(len(refused), 1)
        self.assertIn("crossword for 2026-10-19 (served from data/next)", refused[0])
        accepted, refused = self.check(declaration(("crossword", DAY)))
        self.assertEqual((len(accepted), refused), (1, []))

    def test_a_promotion_that_keeps_the_prepared_boards_passes(self):
        self.publish_base(EVE)
        write_set(self.data / "next", DAY)
        commit_data(self.repo)
        write_set(self.data, DAY)

        self.assertEqual(self.check(declaration()), ([], []))

    def test_a_change_only_in_next_passes(self):
        self.publish_base(EVE)
        write_set(self.data / "next", DAY)
        commit_data(self.repo)
        write_set(self.data / "next", DAY, connections="c2", grid=None)

        self.assertEqual(self.check(declaration()), ([], []))

    def test_the_first_day_without_a_published_set_passes(self):
        write_set(self.data, DAY)

        self.assertEqual(self.check(declaration()), ([], []))

    def test_a_new_day_does_not_swap_the_day_before(self):
        self.publish_base(EVE)
        write_set(self.data, DAY, connections="c2", grid="g2")

        self.assertEqual(self.check(declaration()), ([], []))

    def test_a_board_dropped_without_declaration_is_refused(self):
        self.publish_base()
        write_set(self.data, DAY, grid=None)

        _, refused = self.check(declaration())

        self.assertEqual(len(refused), 1)
        self.assertIn("grid for 2026-10-19", refused[0])
        self.assertIn("absent", refused[0])

    def test_only_the_daily_quiz_sessions_count_as_the_quiz_board(self):
        self.publish_base()
        manifest = json.loads((self.data / "manifest-v2.json").read_text(encoding="utf-8"))
        manifest["sessions"]["en.standard"]["session_id"] = "rebuilt"
        (self.data / "manifest-v2.json").write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(self.check(declaration()), ([], []))

        write_set(self.data, DAY, quiz="q2")
        self.assertEqual(len(self.check(declaration())[1]), 1)

    def test_a_missing_declaration_file_fails_closed(self):
        self.publish_base()
        stderr = io.StringIO()

        with patch("pathlib.Path.cwd", return_value=self.repo), redirect_stderr(stderr):
            code = main(["--data-dir", "data", "--board-swaps-file", str(self.repo / "absent.json")])

        self.assertEqual(code, 1)
        self.assertIn("could not run", stderr.getvalue())

    def test_an_unknown_base_ref_fails_closed(self):
        self.publish_base()
        swaps = self.repo / "swaps.json"
        swaps.write_text(json.dumps(declaration()), encoding="utf-8")
        stderr = io.StringIO()

        with patch("pathlib.Path.cwd", return_value=self.repo), redirect_stderr(stderr):
            code = main(["--data-dir", "data", "--base-ref", "no-such-ref", "--board-swaps-file", str(swaps)])

        self.assertEqual(code, 1)
        self.assertIn("could not run", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
