"""Self-merge of the publication jobs: only this repository's pull request at the pushed commit.

The end-to-end cases run ``scripts/publish_via_pr.py`` as the workflows do,
with ``tests/fixtures/fake_gh.py`` installed as ``gh`` on ``PATH``.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from scripts.publish_via_pr import PublishError, main, own_pull_requests, publish

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "publish_via_pr.py"
FAKE_GH = ROOT / "tests" / "fixtures" / "fake_gh.py"
WORKFLOWS = ROOT / ".github" / "workflows"

REPOSITORY = "pedrosatin/kpop-quiz"
BRANCH = "automation/daily-puzzles"
TITLE = "Publish daily puzzles for 2026-11-13"
PUSHED = "a" * 40
FORK_HEAD = "f" * 40
OTHER_HEAD = "b" * 40


def pull_request(number: int, head: str, *, repository: str = REPOSITORY, **changes) -> dict:
    owner, name = repository.split("/")
    return {
        "number": number,
        "state": "OPEN",
        "headRefName": BRANCH,
        "headRefOid": head,
        "baseRefName": "master",
        "isCrossRepository": repository != REPOSITORY,
        "headRepository": {"name": name},
        "headRepositoryOwner": {"login": owner},
        **changes,
    }


def fork_pull_request(number: int = 7, head: str = FORK_HEAD) -> dict:
    return pull_request(number, head, repository="mallory/kpop-quiz")


@unittest.skipIf(os.name == "nt", "the fake gh is installed through a shebang")
class PublishWithFakeGhTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.state_path = self.folder / "github.json"
        bin_dir = self.folder / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text(f"#!{sys.executable}\n{FAKE_GH.read_text(encoding='utf-8')}", encoding="utf-8")
        gh.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_GH_STATE": str(self.state_path),
            "GITHUB_REPOSITORY": REPOSITORY,
        }

    def run_script(self, pull_requests: list[dict], *, head_sha: str = PUSHED, **state) -> tuple[
        subprocess.CompletedProcess, dict
    ]:
        self.state_path.write_text(json.dumps({
            "repository": REPOSITORY,
            "branches": {BRANCH: PUSHED},
            "pull_requests": pull_requests,
            **state,
        }), encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "--branch", BRANCH, "--head-sha", head_sha,
             "--title", TITLE, "--body", "Automated publication.", "--retry-delay", "0"],
            env=self.env, cwd=self.folder, capture_output=True, text=True, timeout=60, check=False,
        )
        return completed, json.loads(self.state_path.read_text(encoding="utf-8"))

    def commands(self, github: dict) -> list[str]:
        return [call[1] for call in github.get("calls", [])]

    def test_fork_listed_first_is_ignored_and_the_job_merges_its_own(self):
        completed, github = self.run_script([fork_pull_request()])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(github["merged"], [
            {"number": 8, "sha": PUSHED, "cross_repository": False, "subject": TITLE},
        ])
        fork = github["pull_requests"][0]
        self.assertEqual((fork["number"], fork["state"]), (7, "OPEN"))
        self.assertEqual(self.commands(github), ["list", "create", "list", "merge"])
        self.assertNotIn(BRANCH, github["branches"])

    def test_fork_listed_after_the_own_pull_request_is_ignored(self):
        completed, github = self.run_script([pull_request(5, PUSHED), fork_pull_request()])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([item["number"] for item in github["merged"]], [5])
        self.assertEqual(self.commands(github), ["list", "merge"])

    def test_own_pull_request_is_reused_with_the_fork_listed_first(self):
        completed, github = self.run_script([fork_pull_request(), pull_request(9, PUSHED)])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([(item["number"], item["sha"]) for item in github["merged"]], [(9, PUSHED)])
        self.assertNotIn("create", self.commands(github))

    def test_fork_that_copied_the_pushed_commit_is_still_ignored(self):
        completed, github = self.run_script([fork_pull_request(head=PUSHED)])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(
            [(item["number"], item["cross_repository"]) for item in github["merged"]], [(8, False)],
        )

    def test_same_owner_fork_under_another_name_is_ignored(self):
        renamed = pull_request(7, FORK_HEAD, repository="pedrosatin/kpop-quiz-fork")
        completed, github = self.run_script([renamed])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([item["number"] for item in github["merged"]], [8])

    def test_merge_carries_the_pushed_commit(self):
        _, github = self.run_script([fork_pull_request()])
        merge = github["calls"][-1]
        self.assertEqual(merge[:3], ["pr", "merge", "8"])
        self.assertEqual(merge[merge.index("--match-head-commit") + 1], PUSHED)
        self.assertEqual(merge[merge.index("--repo") + 1], REPOSITORY)

    def test_head_moved_between_creation_and_merge_fails_the_merge(self):
        completed, github = self.run_script([fork_pull_request()], push_before_merge=OTHER_HEAD)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("Head branch was modified", completed.stderr)
        self.assertEqual(github["merged"], [])
        own = github["pull_requests"][-1]
        self.assertEqual((own["number"], own["state"], own["headRefOid"]), (8, "OPEN", OTHER_HEAD))

    def test_head_moved_on_a_reused_pull_request_fails_the_merge(self):
        completed, github = self.run_script([pull_request(5, PUSHED)], push_before_merge=OTHER_HEAD)
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(github["merged"], [])

    def test_own_pull_request_at_another_commit_stops_before_create_and_merge(self):
        completed, github = self.run_script([fork_pull_request(), pull_request(5, OTHER_HEAD)])
        self.assertEqual(completed.returncode, 1)
        self.assertIn(f"#5 at {OTHER_HEAD}", completed.stderr)
        self.assertEqual(github["merged"], [])
        self.assertEqual(self.commands(github), ["list"] * 5)

    def test_own_pull_request_is_reused_once_github_shows_the_pushed_head(self):
        late = pull_request(5, OTHER_HEAD, pending_head=PUSHED, pending_listings=2)
        completed, github = self.run_script([fork_pull_request(), late])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([(item["number"], item["sha"]) for item in github["merged"]], [(5, PUSHED)])
        self.assertEqual(self.commands(github), ["list", "list", "list", "merge"])

    def test_own_pull_request_beyond_gh_default_page_is_found(self):
        forks = [
            pull_request(number, FORK_HEAD, repository=f"fork{number}/kpop-quiz")
            for number in range(1, 41)
        ]
        completed, github = self.run_script([*forks, pull_request(41, PUSHED)])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual([item["number"] for item in github["merged"]], [41])

    def test_sha_that_is_not_a_full_commit_never_reaches_gh(self):
        for head_sha in ("", "abc1234", "HEAD", PUSHED.upper()):
            with self.subTest(head_sha=head_sha):
                completed, github = self.run_script([pull_request(5, PUSHED)], head_sha=head_sha)
                self.assertEqual(completed.returncode, 1)
                self.assertIn("full 40-character SHA", completed.stderr)
                self.assertNotIn("calls", github)


class OwnPullRequestsTests(unittest.TestCase):
    def own(self, *pull_requests: dict) -> list[int]:
        return [
            item["number"]
            for item in own_pull_requests(
                pull_requests, repository=REPOSITORY, branch=BRANCH, base="master",
            )
        ]

    def test_keeps_only_the_repository_itself(self):
        self.assertEqual(self.own(fork_pull_request(), pull_request(5, PUSHED)), [5])

    def test_repository_name_ignores_case(self):
        same = pull_request(
            5, PUSHED, headRepository={"name": "Kpop-Quiz"}, headRepositoryOwner={"login": "PedroSatin"},
        )
        self.assertEqual(self.own(same), [5])

    def test_rejects_what_does_not_prove_the_origin(self):
        cases = {
            "cross repository flag": {"isCrossRepository": True},
            "missing flag": {"isCrossRepository": None},
            "deleted fork": {"headRepository": None, "headRepositoryOwner": None},
            "no owner": {"headRepositoryOwner": {}},
            "other owner": {"headRepositoryOwner": {"login": "mallory"}},
            "other repository name": {"headRepository": {"name": "kpop-quiz-fork"}},
            "other branch": {"headRefName": "automation/map-pilot-refresh"},
            "other base": {"baseRefName": "dev"},
        }
        for name, changes in cases.items():
            with self.subTest(name):
                self.assertEqual(self.own(pull_request(5, PUSHED, **changes)), [])


class PublishTests(unittest.TestCase):
    def publish(self, answers: list, **changes) -> tuple[list[list[str]], list[float]]:
        """Run ``publish`` against scripted ``gh`` answers; return the calls and the waits."""
        calls: list[list[str]] = []
        waits: list[float] = []

        def run(args):
            calls.append(list(args))
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer if isinstance(answer, str) else json.dumps(answer)

        options = dict(
            repository=REPOSITORY, branch=BRANCH, base="master", head_sha=PUSHED,
            title=TITLE, body="", run=run, sleep=waits.append, attempts=3, retry_delay=2.0,
        )
        with redirect_stdout(io.StringIO()):
            publish(**{**options, **changes})
        return calls, waits

    def test_lists_open_pull_requests_of_the_branch_past_the_default_page(self):
        calls, _ = self.publish([[pull_request(5, PUSHED)], ""])
        listing = calls[0]
        self.assertEqual(listing[:2], ["pr", "list"])
        for flag, value in (("--repo", REPOSITORY), ("--head", BRANCH), ("--base", "master"),
                            ("--state", "open"), ("--limit", "100")):
            self.assertEqual(listing[listing.index(flag) + 1], value)
        for field in ("isCrossRepository", "headRepository", "headRepositoryOwner", "headRefOid"):
            self.assertIn(field, listing[listing.index("--json") + 1])

    def test_waits_for_the_created_pull_request_to_be_listed(self):
        calls, waits = self.publish([[], "", [], [pull_request(8, PUSHED)], ""])
        self.assertEqual([call[1] for call in calls], ["list", "create", "list", "list", "merge"])
        self.assertEqual(waits, [2.0])
        self.assertEqual(calls[-1][2], "8")

    def test_created_pull_request_never_listed_fails_without_merge(self):
        answers = [[fork_pull_request()], "", [fork_pull_request()], [], []]
        with self.assertRaisesRegex(PublishError, "No pull request of pedrosatin/kpop-quiz"):
            self.publish(answers)
        self.assertEqual(answers, [])

    def test_gh_failure_stops_the_publication(self):
        with self.assertRaisesRegex(PublishError, "rate limit"):
            self.publish([PublishError("gh pr list failed with exit 1: rate limit")])

    def test_listing_that_is_not_a_list_of_pull_requests_fails(self):
        for answer in ("not json", {"number": 5}):
            with self.subTest(answer=answer):
                with self.assertRaises(PublishError):
                    self.publish([answer])

    def test_rejects_a_repository_that_is_not_owner_and_name(self):
        for repository in ("", "kpop-quiz", "a/b/c"):
            with self.subTest(repository=repository):
                with self.assertRaisesRegex(PublishError, "OWNER/NAME"):
                    self.publish([], repository=repository)

    def test_main_reports_the_failure_and_exits_1(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            code = main(["--repo", REPOSITORY, "--branch", BRANCH, "--head-sha", "", "--title", TITLE])
        self.assertEqual(code, 1)
        self.assertIn("::error::", stderr.getvalue())


class WorkflowTests(unittest.TestCase):
    def test_publication_workflows_merge_through_the_script(self):
        for workflow, branch in (
            ("daily-puzzles-cron.yml", "automation/daily-puzzles"),
            ("map-pilot-refresh.yml", "automation/map-pilot-refresh"),
        ):
            with self.subTest(workflow):
                text = (WORKFLOWS / workflow).read_text(encoding="utf-8")
                self.assertIn(f"BRANCH: {branch}", text)
                self.assertIn("python3 scripts/publish_via_pr.py", text)
                self.assertIn('head_sha="$(git rev-parse HEAD)"', text)
                self.assertIn('--head-sha "${head_sha}"', text)
                for inline in ("gh pr list", "gh pr create", "gh pr merge"):
                    self.assertNotIn(inline, text)

    def test_no_other_workflow_merges_a_pull_request(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            with self.subTest(path.name):
                self.assertNotIn("gh pr merge", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
