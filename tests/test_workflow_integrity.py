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
            [
                "python3 -m kpop_scraping.publish_file_set web/public/data --suffix .json",
                f"python3 -m kpop_scraping.web_publish {shlex.join(gate_arguments())}",
            ],
        ),
        (
            "map-pilot-refresh.yml",
            "Apply refreshed dataset",
            "Verify downloaded dataset",
            [
                "python3 -m kpop_scraping.publish_file_set data/map-pilot --only deadline-events.json",
                "python3 -m kpop_scraping.map_pilot_refresh --verify --output data/map-pilot/deadline-events.json",
            ],
        ),
    )

    def test_verification_runs_between_the_download_and_the_commit(self):
        for workflow, apply, verify, commands in self.CASES:
            with self.subTest(workflow):
                steps = job_steps((WORKFLOWS / workflow).read_text(encoding="utf-8"), "publish")
                names = [name for name, _text in steps]
                self.assertEqual(names[names.index(apply) + 1], verify, names)
                self.assertEqual(names[names.index(verify) + 1], "Publish via pull request", names)
                text = dict(steps)[verify]
                # Both commands, in this order and nothing else: the runner's
                # bash -e stops at the first one that fails.
                self.assertIn("run: |\n" + "".join(f"          {command}\n" for command in commands), text)
                self.assertEqual(text.count("python3 "), len(commands), text)
                # A failed check must fail the job: no condition, no tolerance.
                self.assertNotRegex(text, r"\n\s+(if|continue-on-error):")
                # The commit happens in the step right after the check.
                self.assertIn("\n          git add ", dict(steps)["Publish via pull request"])

    def test_jobs_that_build_the_published_site_install_without_scripts(self):
        cron = dict(job_steps(CRON.read_text(encoding="utf-8"), "daily-puzzles"))
        self.assertIn("run: npm ci --ignore-scripts\n", cron["Install web dependencies"])
        build = job_text(WORKFLOWS / "pages.yml", "build")
        self.assertIn("- run: npm ci --ignore-scripts\n", build)
        self.assertNotRegex(build, r"npm ci(?! --ignore-scripts)")
        # ignore-scripts in an .npmrc would also skip the pretest:e2e build.
        self.assertFalse((ROOT / "web" / ".npmrc").exists())
        self.assertFalse((ROOT / ".npmrc").exists())

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

    def test_deploy_downloads_the_site_after_the_checkout(self):
        # The checkout cleans the workspace; a download before it would be
        # wiped and the deploy would upload an empty or missing web/dist.
        checkout = self.deploy.index("uses: actions/checkout@")
        download = self.deploy.index("uses: actions/download-artifact@")
        self.assertLess(checkout, download)
        self.assertIn("name: web-dist\n          path: web/dist\n", self.deploy[download:])

    def test_deploy_step_receives_both_cloudflare_credentials(self):
        step = self.deploy.split("- name: Deploy to Cloudflare Pages\n", 1)[1].split("\n      - ", 1)[0]
        env = step.split("\n        env:\n", 1)[1].split("\n        run:", 1)[0]
        self.assertEqual(
            sorted(line.strip() for line in env.splitlines()),
            [
                "CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
                "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
            ],
        )
        self.assertIn("\n        working-directory: web\n", step)

    def test_dependabot_updates_web_npm_dependencies(self):
        config = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        self.assertRegex(config, r"package-ecosystem: npm\n\s+directory: /web\n")



def job_names(path: Path) -> list[str]:
    jobs = path.read_text(encoding="utf-8").split("\njobs:\n", 1)[1]
    return re.findall(r"^  ([\w-]+):\n", jobs, flags=re.MULTILINE)


def job_needs(job: str) -> list[str]:
    match = re.search(r"^    needs: (.+)$", job, flags=re.MULTILINE)
    if not match:
        return []
    return [name.strip() for name in match.group(1).strip("[]").split(",")]


def job_condition(job: str) -> str:
    """The job's ``if:``, folded into one line as ``>-`` folds it."""
    match = re.match(r"\s*if: (>-\n(?:      .*\n)+|.*\n)", job)
    if not match:
        return ""
    return " ".join(line.strip() for line in match.group(1).removeprefix(">-").splitlines() if line.strip())


def step_env(job: str, step: str) -> list[str]:
    text = "\n" + job.split(f"- name: {step}\n", 1)[1].split("\n      - ", 1)[0]
    env = text.split("\n        env:\n", 1)[1].split("\n        run:", 1)[0]
    return sorted(line.strip() for line in env.splitlines())


class ParallelJobsTests(unittest.TestCase):
    """The checks run as parallel jobs and deploy waits for all of them."""

    PAGES = WORKFLOWS / "pages.yml"
    CHECKS = ["python", "vitest", "build", "e2e"]
    PUBLISHERS = ["deploy", "smoke-prod"]
    DEPLOY_CONDITION = "github.event_name != 'pull_request' && github.ref == 'refs/heads/master'"
    WORKFLOW_RUN_GUARD = (
        "github.event_name != 'workflow_run' || "
        "(github.event.workflow_run.conclusion == 'success' && "
        "github.event.workflow_run.head_repository.full_name == github.repository && "
        """contains(fromJSON('["push","schedule","workflow_dispatch"]'), github.event.workflow_run.event))"""
    )

    def job(self, name: str) -> str:
        return job_text(self.PAGES, name)

    def test_deploy_needs_every_check_job(self):
        self.assertEqual(job_names(self.PAGES), self.CHECKS + self.PUBLISHERS)
        self.assertEqual(sorted(job_needs(self.job("deploy"))), sorted(self.CHECKS))
        for name in self.CHECKS:
            self.assertEqual(job_needs(self.job(name)), [], name)

    def test_checks_skip_the_same_workflow_runs(self):
        for name in ("vitest", "build", "e2e"):
            self.assertEqual(job_condition(self.job(name)), self.WORKFLOW_RUN_GUARD, name)
        self.assertEqual(
            job_condition(self.job("python")),
            f"github.event_name != 'pull_request' && ({self.WORKFLOW_RUN_GUARD})",
        )

    def test_deploy_publishes_the_artifact_of_the_build_job(self):
        build = self.job("build")
        upload = build.split("uses: actions/upload-artifact@", 1)[1]
        self.assertIn(
            "with:\n          name: web-dist\n          path: web/dist\n          include-hidden-files: true\n",
            upload,
        )
        for name in ("python", "vitest", "e2e", "smoke-prod"):
            self.assertNotIn("name: web-dist", self.job(name), name)
        deploy = self.job("deploy")
        self.assertEqual(deploy.count("uses: actions/download-artifact@"), 1)
        self.assertIn("name: web-dist\n          path: web/dist\n", deploy)

    def test_deploy_builds_nothing(self):
        deploy = self.job("deploy")
        self.assertNotRegex(deploy, r"npm (run|test|run-script)\b|astro (build|check)")
        self.assertNotRegex(deploy, r"\n\s+(cache|cache-dependency-path):")

    def test_artifact_is_uploaded_only_when_deploy_runs(self):
        self.assertEqual(job_condition(self.job("deploy")), self.DEPLOY_CONDITION)
        upload = self.job("build").split("uses: actions/upload-artifact@", 1)[1]
        self.assertIn(f"\n        if: {self.DEPLOY_CONDITION}\n", upload.split("\n      - ", 1)[0])

    def test_end_to_end_suite_builds_like_the_published_build(self):
        build, e2e = self.job("build"), self.job("e2e")
        self.assertEqual(step_env(e2e, "Build production site"), step_env(build, "Build production site"))
        self.assertEqual(e2e.count("run: npm run build\n"), 1)
        self.assertIn("run: npm run test:e2e:ci\n", e2e)
        self.assertNotIn("test:e2e:ci", build)
        self.assertNotRegex(e2e, r"npm ci(?! --ignore-scripts)")

    def test_smoke_runs_after_a_deploy(self):
        smoke = self.job("smoke-prod")
        self.assertEqual(job_needs(smoke), ["deploy"])
        self.assertIn("needs.deploy.outputs.deployed == 'true'", job_condition(smoke))

    def test_cloudflare_secrets_stay_in_the_deploy_job(self):
        text = self.PAGES.read_text(encoding="utf-8")
        deploy = self.job("deploy")
        self.assertEqual(text.count("secrets.CLOUDFLARE_"), deploy.count("secrets.CLOUDFLARE_"))
        for workflow in workflows():
            if workflow != self.PAGES:
                self.assertNotIn("secrets.CLOUDFLARE_", workflow.read_text(encoding="utf-8"), workflow.name)

    def test_ci_runs_python_and_web_in_separate_jobs(self):
        ci = WORKFLOWS / "ci.yml"
        self.assertEqual(job_names(ci), ["python", "web", "code-feedback"])
        python, web = job_text(ci, "python"), job_text(ci, "web")
        self.assertIn("python -m compileall -q .\n", python)
        self.assertIn("python -m pytest tests -n logical", python)
        self.assertNotIn("npm ", python)
        for command in ("run: npm ci\n", "run: npm test\n", "run: npm run build\n"):
            self.assertIn(command, web)
        self.assertNotIn("python", web)
        self.assertEqual(job_needs(python) + job_needs(web), [])


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
