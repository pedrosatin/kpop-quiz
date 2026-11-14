"""The publication chain depends only on pinned and verified inputs (ADR 040).

The checks read the workflow files as text, like the other workflow tests:
PyYAML is not in the standard library.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import unittest
from pathlib import Path

from kpop_scraping.workflow_commands import escape_data
from tests.test_artifacts_gate import gate_arguments
from tests.test_rebuild_database import job_steps

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
CRON = WORKFLOWS / "daily-puzzles-cron.yml"

USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(\S+)(.*)$")
PINNED = re.compile(r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$")
VERSION_COMMENT = re.compile(r"^\s+# v\d+\.\d+\.\d+$")


def workflows() -> list[Path]:
    return sorted(WORKFLOWS.glob("*.yml"))


def uses_lines(path: Path) -> list[tuple[int, str, str]]:
    """``(line number, action reference, rest of the line)`` of every ``uses:``."""
    found = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        match = USES.match(line)
        if match:
            found.append((number, match.group(1), match.group(2)))
    return found


def job_text(path: Path, job: str) -> str:
    body = path.read_text(encoding="utf-8").split(f"\n  {job}:\n", 1)[1]
    following = re.search(r"^  \S", body, flags=re.MULTILINE)
    return body[: following.start()] if following else body


class PinnedActionTests(unittest.TestCase):
    def test_every_action_is_pinned_to_a_full_commit_sha_with_its_version(self):
        offenders = []
        for path in workflows():
            for number, action, rest in uses_lines(path):
                if action.startswith("./"):
                    continue
                if not PINNED.match(action) or not VERSION_COMMENT.match(rest):
                    offenders.append(f"{path.name}:{number}: {action}{rest}")
        self.assertEqual(offenders, [])

    def test_each_action_uses_one_commit_across_workflows(self):
        commits: dict[str, set[str]] = {}
        for path in workflows():
            for _number, action, rest in uses_lines(path):
                name, _, sha = action.partition("@")
                commits.setdefault(name, set()).add(f"{sha}{rest}")
        self.assertEqual({name: shas for name, shas in commits.items() if len(shas) > 1}, {})

    def test_cache_matches_the_cron(self):
        cron = {action for _n, action, _r in uses_lines(CRON) if action.startswith("actions/cache@")}
        self.assertEqual(len(cron), 1)
        for path in workflows():
            for number, action, _rest in uses_lines(path):
                if action.startswith("actions/cache@"):
                    self.assertIn(action, cron, f"{path.name}:{number}")


class AnalyticsIdTests(unittest.TestCase):
    def test_public_ids_read_the_variable_first_and_the_secret_only_as_fallback(self):
        offenders = []
        for path in workflows():
            text = path.read_text(encoding="utf-8")
            for match in re.finditer(r"secrets\.(PUBLIC_\w+)", text):
                name = match.group(1)
                if not text[: match.start()].endswith(f"vars.{name} || "):
                    line = text.count("\n", 0, match.start()) + 1
                    offenders.append(f"{path.name}:{line}: secrets.{name}")
        self.assertEqual(offenders, [])

    def test_production_build_reads_both_ids(self):
        text = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")
        for name in ("PUBLIC_CF_BEACON_TOKEN", "PUBLIC_GA4_ID"):
            self.assertIn(f"{name}: ${{{{ vars.{name} || secrets.{name} }}}}", text)


class PublishVerificationTests(unittest.TestCase):
    """The publish jobs check the downloaded files before ``git add``."""

    CASES = (
        (
            "daily-puzzles-cron.yml",
            "Apply generated data",
            "Verify downloaded data",
            f"python3 -m kpop_scraping.web_publish {shlex.join(gate_arguments())}",
        ),
        (
            "map-pilot-refresh.yml",
            "Apply refreshed dataset",
            "Verify downloaded dataset",
            "python3 -m kpop_scraping.map_pilot_refresh --verify --output data/map-pilot/deadline-events.json",
        ),
    )

    def test_verification_runs_between_the_download_and_the_commit(self):
        for workflow, apply, verify, command in self.CASES:
            with self.subTest(workflow):
                steps = job_steps((WORKFLOWS / workflow).read_text(encoding="utf-8"), "publish")
                names = [name for name, _text in steps]
                self.assertEqual(names[names.index(apply) + 1], verify, names)
                self.assertEqual(names[names.index(verify) + 1], "Publish via pull request", names)
                text = dict(steps)[verify]
                self.assertIn(f"run: {command}\n", text)
                # A failed check must fail the job: no condition, no tolerance.
                self.assertNotRegex(text, r"\n\s+(if|continue-on-error):")
                # The commit happens in the step right after the check.
                self.assertIn("\n          git add ", dict(steps)["Publish via pull request"])

    def test_cron_gate_is_the_one_the_generating_job_runs(self):
        script = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))["scripts"]
        self.assertIn("kpop_scraping.web_publish --output-dir web/public/data --verify", script["artifacts:verify"])
        steps = dict(job_steps(CRON.read_text(encoding="utf-8"), "daily-puzzles"))
        self.assertIn("run: npm run artifacts:verify\n", steps["Verify published artifacts"])


class DeployToolingTests(unittest.TestCase):
    def setUp(self):
        self.deploy = job_text(WORKFLOWS / "pages.yml", "deploy")
        self.package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
        self.lock = json.loads((ROOT / "web" / "package-lock.json").read_text(encoding="utf-8"))

    def test_wrangler_is_an_exact_dev_dependency_in_the_lockfile(self):
        version = self.package["devDependencies"]["wrangler"]
        self.assertRegex(version, r"^\d+\.\d+\.\d+$")
        self.assertEqual(self.lock["packages"][""]["devDependencies"]["wrangler"], version)
        self.assertEqual(self.lock["packages"]["node_modules/wrangler"]["version"], version)

    def test_deploy_runs_the_locked_wrangler_without_install_scripts(self):
        self.assertNotIn("uses: cloudflare/wrangler-action", self.deploy)
        self.assertNotIn("wranglerVersion", self.deploy)
        self.assertNotRegex(self.deploy, r"npm (i|install)\b")
        self.assertIn("run: npm ci --ignore-scripts --no-audit --no-fund\n", self.deploy)
        self.assertIn(
            "run: npx --no-install wrangler pages deploy dist --project-name=kpopquiz --branch=master\n",
            self.deploy,
        )
        self.assertLess(self.deploy.index("npm ci --ignore-scripts"), self.deploy.index("wrangler pages deploy"))

    def test_deploy_job_restores_no_cache(self):
        self.assertNotIn("actions/cache@", self.deploy)
        self.assertNotRegex(self.deploy, r"\n\s+cache:")

    def test_deploy_checkout_keeps_no_credentials(self):
        self.assertIn("actions/checkout@", self.deploy)
        self.assertIn("persist-credentials: false", self.deploy)

    def test_dependabot_updates_web_npm_dependencies(self):
        config = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        self.assertRegex(config, r"package-ecosystem: npm\n\s+directory: /web\n")


class WorkflowShellEscapeTests(unittest.TestCase):
    def test_staging_noindex_error_escapes_the_path_list(self):
        workflow = (WORKFLOWS / "staging.yml").read_text(encoding="utf-8")
        escapes = [line.strip() for line in workflow.splitlines() if line.strip().startswith("missing=${missing//")]
        self.assertEqual(len(escapes), 3, escapes)
        value = "dist/100%/a.html\ndist/b\r.html\ndist/::error::x.html"
        script = "\n".join([*escapes, 'printf "%s" "$missing"'])
        completed = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
            env={"missing": value, "PATH": os.environ["PATH"]},
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(completed.stdout, escape_data(value))
        self.assertIn('echo "::error::Staging HTML missing noindex: $missing"', workflow)

    def test_indexnow_prints_the_remote_body_as_one_json_string(self):
        workflow = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("jq -Rs . indexnow-response.txt", workflow)
        self.assertNotIn("cat indexnow-response.txt", workflow)


if __name__ == "__main__":
    unittest.main()
