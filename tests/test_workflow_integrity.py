"""The publication chain depends only on pinned and verified inputs (ADR 040).

The checks read the workflow files as text, like the other workflow tests:
PyYAML is not in the standard library.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest
import zipfile
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
    match = re.search(r"^    if: (>-\n(?:      .*\n)+|.*\n)", job, flags=re.MULTILINE)
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
    CHECKS = ["artifacts", "python", "vitest", "build", "e2e"]
    E2E_FOLLOW_UPS = ["e2e-report", "e2e-verdict"]
    WEB_CHECKS = ["vitest", "build", "e2e", *E2E_FOLLOW_UPS]
    PUBLISHERS = ["deploy", "smoke-prod"]
    DEPLOY_CONDITION = "github.event_name != 'pull_request' && github.ref == 'refs/heads/master'"
    WEB_CHANGED = "(needs.changes.result != 'success' || needs.changes.outputs.web == 'true')"
    WORKFLOW_RUN_GUARD = (
        "github.event_name != 'workflow_run' || "
        "(github.event.workflow_run.conclusion == 'success' && "
        "github.event.workflow_run.head_repository.full_name == github.repository && "
        """contains(fromJSON('["push","schedule","workflow_dispatch"]'), github.event.workflow_run.event))"""
    )

    def job(self, name: str) -> str:
        return job_text(self.PAGES, name)

    def test_deploy_needs_every_check_job(self):
        self.assertEqual(job_names(self.PAGES), ["changes"] + self.CHECKS + self.E2E_FOLLOW_UPS + self.PUBLISHERS)
        self.assertEqual(sorted(job_needs(self.job("deploy"))), sorted([*self.CHECKS, "e2e-verdict"]))
        for name in self.CHECKS:
            self.assertEqual(job_needs(self.job(name)), ["changes"] if name in self.WEB_CHECKS else [], name)
        self.assertEqual(job_needs(self.job("e2e-report")), ["changes", "e2e"])
        self.assertEqual(job_needs(self.job("e2e-verdict")), ["changes", "e2e", "e2e-report"])

    def test_deploy_never_runs_past_a_failed_or_skipped_need(self):
        # Without a status function, deploy runs only when every need
        # succeeded: a red, cancelled or skipped E2E verdict skips it.
        condition = job_condition(self.job("deploy"))
        for function in ("always()", "cancelled()", "failure()", "success()"):
            self.assertNotIn(function, condition)

    def test_checks_skip_the_same_workflow_runs(self):
        for name in self.WEB_CHECKS:
            self.assertEqual(
                job_condition(self.job(name)),
                f"!cancelled() && {self.WEB_CHANGED} && ({self.WORKFLOW_RUN_GUARD})",
                name,
            )
        self.assertEqual(job_condition(self.job("artifacts")), self.WORKFLOW_RUN_GUARD)
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
        self.assertIn('npm run test:e2e:ci -- --reporter=list,blob "$SELECTION"\n', e2e)
        self.assertNotIn("test:e2e:ci", build)
        for name in ("e2e", "e2e-report"):
            self.assertIn("- run: npm ci --ignore-scripts\n", self.job(name), name)
            self.assertNotRegex(self.job(name), r"npm ci(?! --ignore-scripts)", name)

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
        self.assertEqual(
            job_names(ci), ["changes", "python", "workflow-integrity", "web", "code-feedback"]
        )
        python, web = job_text(ci, "python"), job_text(ci, "web")
        self.assertIn("python -m compileall -q .\n", python)
        self.assertIn("python -m pytest tests -n logical", python)
        self.assertNotIn("npm ", python)
        for command in ("run: npm ci\n", "run: npm test\n", "run: npm run build\n"):
            self.assertIn(command, web)
        self.assertNotIn("python", web)
        # Web waits for nothing: only the Python jobs wait for the detection.
        self.assertEqual(job_needs(web), [])
        self.assertEqual(job_needs(python), ["changes"])


def step_script(path: Path, job: str, step: str) -> str:
    """The ``run: |`` text of a step, as the runner writes it to a file."""
    text = dict(job_steps(path.read_text(encoding="utf-8"), job))[step]
    lines = text.split("\n        run: |\n", 1)[1].split("\n")
    block = []
    for line in lines:
        if line.strip() and not line.startswith(" " * 10):
            break
        block.append(line[10:])
    return "\n".join(block).strip("\n") + "\n"


def web_inputs_outside_web() -> set[str]:
    """Repository paths that the web sources read from outside ``web/``."""
    found = set()
    reach_root = re.compile(r"""["']((?:\.\./)+)(\.github/[^"']+)["']""")
    from_root = re.compile(r"""join\(\s*REPO\s*,\s*["']([^"']+)["']""")
    for folder in ("src", "e2e", "scripts"):
        for path in (ROOT / "web" / folder).rglob("*"):
            if path.suffix not in {".ts", ".tsx", ".mjs"} or "node_modules" in path.parts:
                continue
            source = path.read_text(encoding="utf-8")
            found.update(match.group(2) for match in reach_root.finditer(source))
            found.update(match.group(1) for match in from_root.finditer(source))
    return found


class WebChangesTests(unittest.TestCase):
    """Detection of the pull requests that leave the site alone (ticket 10).

    The step runs here with a stand-in for ``gh``, so each rule is checked
    without the API.
    """

    PAGES = WORKFLOWS / "pages.yml"
    CHANGES = WORKFLOWS / "changes.yml"
    STEP = "Detect web and Python changes"
    ZEROS = "0" * 40

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.dir = Path(self._dir.name)
        self.addCleanup(self._dir.cleanup)
        (self.dir / "bin").mkdir()
        (self.dir / "script.sh").write_text(
            step_script(self.CHANGES, "detect", self.STEP), encoding="utf-8"
        )
        sleep = self.dir / "bin" / "sleep"
        sleep.write_text("#!/bin/bash\n", encoding="utf-8")
        sleep.chmod(0o755)

    def fake_gh(self, files: list[str] | None, failures: int = 0):
        """``gh`` that fails ``failures`` times, then prints ``files`` (``None``: always fails)."""
        listing = "".join(f"{name}\n" for name in files or [])
        script = f"""#!/bin/bash
echo "$@" >> "{self.dir}/gh-args"
calls=$(wc -l < "{self.dir}/gh-args")
if [ "{'fail' if files is None else 'ok'}" = fail ] || [ "$calls" -le {failures} ]; then
  echo "gh: HTTP 502" >&2
  exit 1
fi
cat <<'LIST'
{listing}LIST
"""
        gh = self.dir / "bin" / "gh"
        gh.write_text(script, encoding="utf-8")
        gh.chmod(0o755)

    def run_step(self, event: str = "pull_request", files: list[str] | None = (), failures: int = 0):
        self.fake_gh(None if files is None else list(files), failures)
        for name in ("output", "gh-args"):
            (self.dir / name).write_text("", encoding="utf-8")
        completed = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(self.dir / "script.sh")],
            env={
                "PATH": f"{self.dir / 'bin'}:{os.environ['PATH']}",
                "GITHUB_OUTPUT": str(self.dir / "output"),
                "REPOSITORY": "o/r",
                "EVENT_NAME": event,
                "PR_BASE_SHA": "a" * 40,
                "PR_HEAD_SHA": "b" * 40,
            },
            capture_output=True,
            text=True,
        )
        outputs = (self.dir / "output").read_text(encoding="utf-8").split()
        calls = (self.dir / "gh-args").read_text(encoding="utf-8").splitlines()
        return completed, outputs, calls

    def outputs(self, files: list[str], event: str = "pull_request") -> list[str]:
        completed, outputs, _calls = self.run_step(event, files)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return outputs

    def web_output(self, files: list[str], event: str = "pull_request") -> list[str]:
        """The ``web`` line the step wrote (the ``python`` line comes second)."""
        outputs = self.outputs(files, event)
        self.assertEqual([line.split("=")[0] for line in outputs], ["web", "python"], outputs)
        return outputs[:1]

    def python_output(self, files: list[str], event: str = "pull_request") -> list[str]:
        outputs = self.outputs(files, event)
        self.assertEqual([line.split("=")[0] for line in outputs], ["web", "python"], outputs)
        return outputs[1:]

    def test_pull_request_trigger_has_no_paths_filter(self):
        text = self.PAGES.read_text(encoding="utf-8")
        trigger = text.split("\n  pull_request:\n", 1)[1].split("\n  push:\n", 1)[0]
        self.assertNotRegex(trigger, r"(?m)^    paths:")

    def test_both_workflows_call_the_one_detection(self):
        for path in (self.PAGES, WORKFLOWS / "ci.yml"):
            with self.subTest(path.name):
                job = job_text(path, "changes")
                self.assertRegex(job, r"(?m)^    uses: \./\.github/workflows/changes\.yml$")
                self.assertEqual(job_needs(job), [])
                self.assertNotRegex(job, r"(?m)^    (if|with|secrets|continue-on-error):")
        text = self.CHANGES.read_text(encoding="utf-8")
        self.assertRegex(text, r"(?m)^on:\n  workflow_call:\n")
        self.assertNotRegex(text, r"(?m)^  (pull_request|push|workflow_dispatch|schedule|workflow_run):")
        self.assertIn("value: ${{ jobs.detect.outputs.web }}", text)
        self.assertIn("value: ${{ jobs.detect.outputs.python }}", text)

    def test_changes_job_needs_no_checkout_and_no_condition(self):
        job = job_text(self.CHANGES, "detect")
        self.assertNotIn("actions/checkout@", job)
        self.assertEqual(job_needs(job), [])
        self.assertNotRegex(job, r"(?m)^    if:")
        self.assertNotIn("continue-on-error", job)
        self.assertIn("web: ${{ steps.detect.outputs.web }}", job)
        self.assertIn("python: ${{ steps.detect.outputs.python }}", job)
        self.assertEqual(
            step_env(job, self.STEP),
            [
                "EVENT_NAME: ${{ github.event_name }}",
                "GH_TOKEN: ${{ github.token }}",
                "PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
                "PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
                "REPOSITORY: ${{ github.repository }}",
            ],
        )

    def test_only_the_web_jobs_wait_for_the_detection(self):
        for name in job_names(self.PAGES):
            with self.subTest(name):
                needs = job_needs(job_text(self.PAGES, name))
                self.assertEqual("changes" in needs, name in ParallelJobsTests.WEB_CHECKS, needs)

    def test_artifact_check_runs_whatever_the_detection_says(self):
        artifacts = job_text(self.PAGES, "artifacts")
        self.assertNotIn("changes", artifacts)
        self.assertIn("python -m kpop_scraping.web_publish --output-dir web/public/data --verify", artifacts)
        self.assertNotIn("npm ", artifacts)

    def test_site_files_run_the_web_jobs(self):
        for path in (
            "web/src/pages/index.astro",
            "web/package-lock.json",
            "web/public/data/manifest-v2.json",
            "web/e2e/smoke.spec.ts",
            "data/map-pilot/deadline-events.json",
            ".github/workflows/pages.yml",
            "schemas/crossword-daily-v1.json",
            "tests/fixtures/crossword_invalid_cases.json",
            ".github/workflows/staging.yml",
            ".github/workflows/changes.yml",
        ):
            with self.subTest(path):
                self.assertEqual(self.web_output([path]), ["web=true"])
                self.assertEqual(self.web_output(["README.md", "kpop_scraping/a.py", path]), ["web=true"])

    def test_other_files_leave_the_web_jobs_out(self):
        for files in (
            ["kpop_scraping/web_publish.py"],
            ["tests/test_workflow_integrity.py"],
            ["tests/fixtures/other.json"],
            ["requirements.txt", "requirements-ci.txt", "main.py"],
            [".github/workflows/ci.yml", ".github/dependabot.yml"],
            ["data/other/file.json", "docs/decisions/044.md", "README.md"],
            ["webcam/readme.txt", "web.md", "data/map-pilot-old/x.json", "xweb/a.ts"],
        ):
            with self.subTest(files):
                self.assertEqual(self.web_output(files), ["web=false"])

    def test_a_rename_out_of_web_counts_through_the_old_path(self):
        # The stand-in prints what the jq filter would: the filter must list
        # the new filename and previous_filename.
        self.assertEqual(self.web_output(["kpop_scraping/moved.py", "web/src/old.ts"]), ["web=true"])
        self.assertIn(".filename, (.previous_filename // empty)", self.dir.joinpath("script.sh").read_text())

    def test_empty_diff_and_possibly_truncated_list_run_everything(self):
        self.assertEqual(self.outputs([]), ["web=true", "python=true"])
        docs = lambda count: [f"docs/{n}.md" for n in range(count)]  # noqa: E731
        self.assertEqual(self.outputs(docs(299)), ["web=false", "python=false"])
        self.assertEqual(self.outputs(docs(300)), ["web=true", "python=true"])

    def test_other_events_run_everything_without_asking_the_api(self):
        for event in ("push", "workflow_dispatch", "workflow_run", "schedule"):
            with self.subTest(event):
                completed, outputs, calls = self.run_step(event, ["kpop_scraping/a.py"])
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertEqual(outputs, ["web=true", "python=true"])
                self.assertEqual(calls, [])

    def test_compares_the_merge_base_with_the_head(self):
        _completed, _outputs, calls = self.run_step(files=["kpop_scraping/a.py"])
        self.assertEqual(len(calls), 1)
        self.assertIn(f"repos/o/r/compare/{'a' * 40}...{'b' * 40}", calls[0])

    def test_a_failed_listing_fails_the_step_and_sets_no_output(self):
        completed, outputs, calls = self.run_step(files=None)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(outputs, [])
        self.assertEqual(len(calls), 3)

    def test_a_transient_error_is_retried(self):
        completed, outputs, calls = self.run_step(files=["kpop_scraping/a.py"], failures=2)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(outputs, ["web=false", "python=true"])
        self.assertEqual(len(calls), 3)

    def test_every_web_source_read_from_outside_web_runs_the_web_jobs(self):
        found = web_inputs_outside_web()
        # The scan sees the files known today; if it stops seeing them it checks nothing.
        self.assertIn(".github/workflows/staging.yml", found)
        self.assertIn("schemas/crossword-pilot-v1.json", found)
        self.assertIn("tests/fixtures/crossword_invalid_cases.json", found)
        for path in sorted(found):
            with self.subTest(path):
                self.assertEqual(self.web_output([path]), ["web=true"])

    PYTHON_INPUTS = (
        "kpop_scraping/web_publish.py",
        "kpop_scraping/notes.md",
        "tests/test_cli.py",
        "tests/fixtures/other.json",
        "main.py",
        "scripts/rebuild_database.py",
        "data/map-pilot/deadline-events.json",
        "data/other/file.json",
        "schemas/crossword-daily-v1.json",
        "requirements.txt",
        "requirements-ci.txt",
        ".github/workflows/ci.yml",
        ".github/workflows/pages.yml",
        ".github/workflows/changes.yml",
        ".github/workflows/actionlint.yml",
        ".github/dependabot.yml",
        "web/package.json",
        "web/package-lock.json",
        "web/.npmrc",
        "web/public/data/manifest-v2.json",
        "web/src/tests/fixtures/catalog/index.json",
        "web/src/data/map-pilot/world-map.json",
        # Not listed anywhere: unknown paths run the suite.
        "pyproject.toml",
        "Makefile",
        "xweb/a.ts",
        "webcam/readme.txt",
        "src/new.md",
    )
    PYTHON_LEAVES_ALONE = (
        "web/src/pages/index.astro",
        "web/src/components/Quiz/Quiz.tsx",
        "web/src/components/Quiz/Quiz.test.tsx",
        "web/e2e/smoke.spec.ts",
        "web/scripts/seo-verify.mjs",
        "web/public/favicon.svg",
        "web/astro.config.mjs",
        "web/src/data/other.ts",
        "web/src/tests/fixtures/other/x.json",
        "docs/decisions/044.md",
        "docs/diagram.png",
        "README.md",
        "AGENTS.md",
        "LICENSE",
        ".scratch/ci/STATUS.md",
    )

    def test_files_the_python_suite_reads_run_it(self):
        for path in self.PYTHON_INPUTS:
            with self.subTest(path):
                self.assertEqual(self.python_output([path]), ["python=true"])
                self.assertEqual(self.python_output(["README.md", "web/src/a.ts", path]), ["python=true"])

    def test_web_sources_and_documentation_leave_the_python_suite_out(self):
        for path in self.PYTHON_LEAVES_ALONE:
            with self.subTest(path):
                self.assertEqual(self.python_output([path]), ["python=false"])
        self.assertEqual(self.python_output(list(self.PYTHON_LEAVES_ALONE)), ["python=false"])

    def test_python_follows_a_rename_through_the_old_path(self):
        self.assertEqual(self.python_output(["web/src/new.ts", "tests/test_old.py"]), ["python=true"])

    def test_web_and_python_are_decided_apart(self):
        for files, expected in (
            (["web/src/pages/index.astro"], ["web=true", "python=false"]),
            (["kpop_scraping/a.py"], ["web=false", "python=true"]),
            (["docs/a.md"], ["web=false", "python=false"]),
            (["web/package-lock.json"], ["web=true", "python=true"]),
            (["data/map-pilot/deadline-events.json"], ["web=true", "python=true"]),
            ([".github/workflows/ci.yml"], ["web=false", "python=true"]),
            ([".github/workflows/pages.yml"], ["web=true", "python=true"]),
            ([".github/workflows/changes.yml"], ["web=true", "python=true"]),
            (["web/src/pages/index.astro", "kpop_scraping/a.py"], ["web=true", "python=true"]),
        ):
            with self.subTest(files):
                self.assertEqual(self.outputs(files), expected)

    def test_every_web_path_a_python_test_reads_runs_the_python_suite(self):
        # A Python test that starts reading another web file must not slip
        # past the detection. The scan finds the paths the tests name under
        # web/, as "web/a/b" or as "web" / "a" / "b".
        chain = re.compile(r"""["']web["']((?:\s*/\s*["'][^"']+["'])+)""")
        inline = re.compile(r"""["'](web/[^"'\s{}*]+)["']""")
        found = set()
        for path in sorted((ROOT / "tests").glob("test_*.py")):
            if path.name == Path(__file__).name:
                continue
            source = path.read_text(encoding="utf-8")
            for match in chain.finditer(source):
                parts = re.findall(r"""["']([^"']+)["']""", match.group(1))
                found.add("web/" + "/".join(parts))
            found.update(inline.findall(source))
        # The scan sees the files known today; if it stops seeing them it checks nothing.
        self.assertIn("web/package.json", found)
        self.assertIn("web/public/data", found)
        self.assertIn("web/src/data/map-pilot/world-map.json", found)
        self.assertIn("web/src/tests/fixtures/catalog", found)
        for name in sorted(found):
            with self.subTest(name):
                # A folder is named by what is inside it.
                runs = [self.python_output([candidate]) == ["python=true"] for candidate in (name, f"{name}/x.json")]
                self.assertTrue(any(runs), name)


def condition_runs(condition: str, result: str, python: str) -> bool:
    """Evaluate a ``needs.changes`` condition for a finished, not cancelled, run.

    Only the operators these conditions use are understood; anything else
    raises, so a new construct has to be taught here.
    """
    expression = condition.replace("!cancelled()", "True").replace("&&", " and ").replace("||", " or ")
    expression = re.sub(r"!(?!=)", " not ", expression)
    expression = expression.replace("needs.changes.result", repr(result))
    expression = expression.replace("needs.changes.outputs.python", repr(python))
    if re.search(r"[A-Za-z_]\w*\(", expression) or "." in expression.replace("'", ""):
        raise ValueError(f"cannot evaluate {condition!r}")
    return bool(eval(expression, {"__builtins__": {}}))  # noqa: S307 - input is this repository's own workflow


class PythonGateTests(unittest.TestCase):
    """The Python verification of a pull request, and `npm test` (ticket 07)."""

    CI = WORKFLOWS / "ci.yml"
    PAGES = WORKFLOWS / "pages.yml"
    PYTHON_CHANGED = "(needs.changes.result != 'success' || needs.changes.outputs.python == 'true')"

    def test_full_verification_waits_for_the_detection_and_runs_when_it_fails(self):
        python = job_text(self.CI, "python")
        self.assertEqual(job_needs(python), ["changes"])
        self.assertEqual(job_condition(python), f"!cancelled() && {self.PYTHON_CHANGED}")
        for result in ("success", "failure", "skipped"):
            for output in ("true", "false", ""):
                with self.subTest(result=result, output=output):
                    runs = condition_runs(job_condition(python), result, output)
                    # Only a successful detection that found nothing skips it.
                    self.assertEqual(runs, not (result == "success" and output != "true"))

    def test_the_workflow_tests_run_exactly_when_the_full_verification_does_not(self):
        python = job_text(self.CI, "python")
        light = job_text(self.CI, "workflow-integrity")
        self.assertEqual(job_needs(light), ["changes"])
        self.assertIn("run: python -m unittest -v tests.test_workflow_integrity\n", light)
        for result in ("success", "failure", "skipped"):
            for output in ("true", "false", ""):
                with self.subTest(result=result, output=output):
                    full = condition_runs(job_condition(python), result, output)
                    only_workflows = condition_runs(job_condition(light), result, output)
                    self.assertNotEqual(full, only_workflows)

    def test_the_condition_evaluator_rejects_what_it_does_not_know(self):
        self.assertTrue(condition_runs("needs.changes.result == 'success'", "success", ""))
        self.assertFalse(condition_runs("needs.changes.outputs.python != 'true'", "success", "true"))
        with self.assertRaises(ValueError):
            condition_runs("contains(needs.changes.result, 'x')", "success", "")

    def test_master_runs_always_run_the_full_python_suite(self):
        # ci.yml has no push trigger: the master gate is the python job of
        # pages.yml, which a pull request never runs and every other event
        # does (test_other_events_run_everything_without_asking_the_api).
        ci = self.CI.read_text(encoding="utf-8")
        self.assertNotRegex(ci, r"(?m)^  push:")
        self.assertEqual(
            job_condition(job_text(self.PAGES, "python")),
            f"github.event_name != 'pull_request' && ({ParallelJobsTests.WORKFLOW_RUN_GUARD})",
        )
        self.assertNotIn("changes", job_text(self.PAGES, "python"))
        self.assertIn("python -m pytest tests -n logical", job_text(self.PAGES, "python"))

    def test_npm_test_runs_once_per_pull_request(self):
        runners = []
        for path in workflows():
            text = path.read_text(encoding="utf-8")
            if not re.search(r"(?m)^  pull_request:", text):
                continue
            for name in job_names(path):
                job = job_text(path, name)
                for match in re.finditer(r"^( +)(?:- )?run: npm test$", job, flags=re.MULTILINE):
                    step = job[: match.end()].rsplit("\n      - ", 1)[-1]
                    if "if: github.event_name != 'pull_request'" in step:
                        continue
                    runners.append(f"{path.name}:{name}")
        self.assertEqual(runners, ["pages.yml:vitest"])

    def test_web_job_runs_npm_test_only_outside_pull_requests(self):
        web = job_text(self.CI, "web")
        step = web.split("      - name: Run Web tests\n", 1)[1].split("\n      - ", 1)[0]
        self.assertIn("        if: github.event_name != 'pull_request'\n", step)
        self.assertIn("run: npm test\n", step)

    def test_vitest_stays_a_gate_of_every_event_that_deploys(self):
        vitest = job_text(self.PAGES, "vitest")
        self.assertNotIn("pull_request", job_condition(vitest).replace(ParallelJobsTests.WORKFLOW_RUN_GUARD, ""))
        self.assertIn("vitest", job_needs(job_text(self.PAGES, "deploy")))


class E2EShardsTests(unittest.TestCase):
    """The E2E suite runs as a shard matrix, merged and judged by two jobs (ticket 05)."""

    PAGES = WORKFLOWS / "pages.yml"
    FEEDBACK_ENV = [
        "CI: true",
        "CODE_FEEDBACK_CF_BEACON: ${{ (vars.PUBLIC_CF_BEACON_TOKEN || secrets.PUBLIC_CF_BEACON_TOKEN) != '' }}",
        "CODE_FEEDBACK_ENV: ${{ (vars.PUBLIC_GA4_ID || secrets.PUBLIC_GA4_ID) != '' && 'banner' || 'root' }}",
    ]
    ON_MASTER = "github.event_name != 'pull_request' && github.ref == 'refs/heads/master'"

    def setUp(self):
        self.e2e = job_text(self.PAGES, "e2e")
        self.report = job_text(self.PAGES, "e2e-report")
        self.verdict = job_text(self.PAGES, "e2e-verdict")
        self.steps = dict(job_steps(self.PAGES.read_text(encoding="utf-8"), "e2e"))

    def test_shards_are_one_matrix_list_and_every_step_reads_the_total_from_it(self):
        shards = re.findall(r"^        shard: \[(.*)\]$", self.e2e, flags=re.MULTILINE)
        self.assertEqual(len(shards), 1, self.e2e)
        numbers = [int(value) for value in shards[0].split(",")]
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        self.assertGreaterEqual(len(numbers), 2)
        self.assertIn("\n      fail-fast: false\n", self.e2e)
        self.assertIn("    name: e2e (${{ matrix.shard }}/${{ strategy.job-total }})\n", self.e2e)
        plan = step_env(self.e2e, "Plan this shard")
        self.assertIn("SHARD: ${{ matrix.shard }}", plan)
        self.assertIn("TOTAL: ${{ strategy.job-total }}", plan)
        # No other place spells the shard count.
        self.assertNotRegex(self.PAGES.read_text(encoding="utf-8"), r"--shard[ =]\d|/\d+ shards?")

    def test_only_the_shards_may_read_actions(self):
        text = self.PAGES.read_text(encoding="utf-8")
        workflow_permissions = text.split("\npermissions:\n", 1)[1].split("\n\n", 1)[0]
        self.assertEqual(workflow_permissions.strip(), "contents: read")
        self.assertEqual(len(re.findall(r"^\s+actions: read$", text, flags=re.MULTILINE)), 1)
        self.assertIn("    permissions:\n      actions: read\n      contents: read\n", self.e2e)
        self.assertNotRegex(text, r"(?m)^\s+actions: write$")

    def test_the_plan_lists_the_suite_the_shards_run_and_the_report_checks(self):
        self.assertEqual(
            [line for line in step_env(self.e2e, "Plan this shard") if line.startswith(("CI:", "CODE_FEEDBACK"))],
            self.FEEDBACK_ENV,
        )
        run = step_env(self.e2e, "Run Playwright boot and playthrough against local dist")
        self.assertEqual([line for line in run if line.startswith(("CI:", "CODE_FEEDBACK"))], self.FEEDBACK_ENV)
        self.assertIn("PLAYWRIGHT_BLOB_OUTPUT_NAME: report-${{ matrix.shard }}.zip", run)
        self.assertIn("SELECTION: ${{ steps.plan.outputs.selection }}", run)
        self.assertEqual(step_env(self.report, "Check that the shards ran the whole suite"), self.FEEDBACK_ENV)
        plan = step_script(self.PAGES, "e2e", "Plan this shard")
        self.assertIn("node scripts/e2e-shards.mjs plan", plan)
        self.assertIn('--durations "$RUNNER_TEMP/e2e-durations/e2e-durations.json"', plan)
        check = step_script(self.PAGES, "e2e-report", "Check that the shards ran the whole suite")
        self.assertIn("npx playwright test --list --project=chromium --reporter=json", check)
        self.assertIn("node scripts/e2e-shards.mjs check", check)

    def test_shards_upload_their_blob_even_when_tests_fail(self):
        upload = self.e2e.split("uses: actions/upload-artifact@", 1)[1]
        self.assertIn("if: ${{ !cancelled() }}", upload)
        self.assertIn("name: e2e-blob-${{ matrix.shard }}\n          path: web/blob-report/\n", upload)
        self.assertIn("pattern: e2e-blob-*\n          merge-multiple: true\n          path: web/blob-reports\n", self.report)
        self.assertIn("npx playwright merge-reports --reporter=html,json blob-reports", self.report)
        report_upload = self.report.split("uses: actions/upload-artifact@", 1)[1]
        self.assertIn("if: ${{ !cancelled() }}", report_upload)
        self.assertIn("name: playwright-report\n", report_upload)

    def test_only_a_green_master_run_records_durations_under_the_fetched_name(self):
        condition = f"{self.ON_MASTER} && needs.e2e.result == 'success'"
        record = dict(job_steps(self.PAGES.read_text(encoding="utf-8"), "e2e-report"))["Record test durations"]
        self.assertIn(f"\n        if: {condition}\n", record.split("\n      - ", 1)[0])
        upload = self.report.split("uses: actions/upload-artifact@")[2]
        self.assertIn(f"\n        if: {condition}\n", upload)
        self.assertIn("name: e2e-durations\n", upload)
        self.assertIn("if-no-files-found: error", upload)
        self.assertIn("name=e2e-durations&", step_script(self.PAGES, "e2e", "Fetch recorded test durations"))
        # The check runs before, so a report missing tests records nothing.
        names = [name for name, _text in job_steps(self.PAGES.read_text(encoding="utf-8"), "e2e-report")]
        self.assertLess(names.index("Check that the shards ran the whole suite"), names.index("Record test durations"))

    def test_shards_install_only_the_headless_shell_under_their_own_cache_key(self):
        self.assertIn("key: playwright-shell-${{ runner.os }}-${{ hashFiles('web/package-lock.json') }}", self.e2e)
        self.assertIn("run: npx playwright install --with-deps --only-shell chromium\n", self.e2e)
        self.assertNotIn("key: playwright-chromium-", self.e2e)
        # The other Chromium installs keep the full browser and the shared key.
        others = [job_text(WORKFLOWS / "ci.yml", "code-feedback"), job_text(self.PAGES, "smoke-prod")]
        for text in others:
            self.assertIn("playwright-chromium-${{ runner.os }}-", text)
            self.assertNotIn("--only-shell", text)
        for workflow in workflows():
            if workflow != self.PAGES:
                self.assertNotIn("playwright-shell-", workflow.read_text(encoding="utf-8"), workflow.name)

    # The verdict step, run with each combination of results.
    def verdict_exit(self, shards: str, report: str) -> int:
        script = step_script(self.PAGES, "e2e-verdict", "Check the shards and the merged report")
        return subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
            env={"PATH": os.environ["PATH"], "SHARDS": shards, "REPORT": report},
            capture_output=True,
            text=True,
        ).returncode

    def test_verdict_passes_only_when_shards_and_report_passed(self):
        self.assertEqual(self.verdict_exit("success", "success"), 0)
        for shards, report in (
            ("failure", "success"),
            ("success", "failure"),
            ("cancelled", "success"),
            ("skipped", "success"),
            ("success", "skipped"),
            ("", ""),
        ):
            with self.subTest(shards=shards, report=report):
                self.assertNotEqual(self.verdict_exit(shards, report), 0)
        self.assertEqual(
            step_env(self.verdict, "Check the shards and the merged report"),
            ["REPORT: ${{ needs.e2e-report.result }}", "SHARDS: ${{ needs.e2e.result }}"],
        )
        self.assertNotIn("continue-on-error", self.verdict)
        self.assertNotIn("continue-on-error", self.e2e)
        self.assertNotIn("continue-on-error", self.report)

    def run_shard_step(self, selection: str) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as folder:
            bin_dir = Path(folder)
            npm = bin_dir / "npm"
            npm.write_text(f'#!/bin/bash\nprintf "%s\\n" "$@" > "{folder}/args"\n', encoding="utf-8")
            npm.chmod(0o755)
            script = step_script(self.PAGES, "e2e", "Run Playwright boot and playthrough against local dist")
            completed = subprocess.run(
                ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
                env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "SELECTION": selection},
                capture_output=True,
                text=True,
            )
            args = bin_dir / "args"
            return completed.returncode, args.read_text(encoding="utf-8") if args.exists() else ""

    def test_a_shard_runs_only_a_selection_from_the_plan(self):
        for selection in ("--test-list=/tmp/shard-1-of-2.txt", "--shard=2/2"):
            with self.subTest(selection):
                code, args = self.run_shard_step(selection)
                self.assertEqual(code, 0)
                self.assertEqual(args.split("\n")[:-1], ["run", "test:e2e:ci", "--", "--reporter=list,blob", selection])
        for selection in ("", "--grep=smoke", "e2e/smoke.spec.ts"):
            with self.subTest(selection):
                code, args = self.run_shard_step(selection)
                self.assertNotEqual(code, 0)
                self.assertEqual(args, "")


@unittest.skipUnless(shutil.which("jq"), "the stand-in for gh filters with jq")
class DurationsFetchTests(unittest.TestCase):
    """The shards read the durations of the newest master run before theirs."""

    PAGES = WORKFLOWS / "pages.yml"
    REPOSITORY_ID = 7
    RUN_CREATED = "2026-11-18T10:00:00Z"

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.dir = Path(self._dir.name)
        self.addCleanup(self._dir.cleanup)
        (self.dir / "bin").mkdir()
        (self.dir / "temp").mkdir()
        (self.dir / "script.sh").write_text(
            step_script(self.PAGES, "e2e", "Fetch recorded test durations"), encoding="utf-8"
        )
        sleep = self.dir / "bin" / "sleep"
        sleep.write_text("#!/bin/bash\n", encoding="utf-8")
        sleep.chmod(0o755)

    def artifact(self, artifact_id: int, created: str, branch: str = "master", fork: bool = False, expired: bool = False):
        return {
            "id": artifact_id,
            "created_at": created,
            "expired": expired,
            "workflow_run": {
                "head_branch": branch,
                "repository_id": self.REPOSITORY_ID,
                "head_repository_id": self.REPOSITORY_ID + (1 if fork else 0),
            },
        }

    def run_step(self, artifacts: list[dict], fail: str = ""):
        """Runs the step with a ``gh`` that answers from ``artifacts`` and fails on paths matching ``fail``."""
        (self.dir / "run.json").write_text(json.dumps({"created_at": self.RUN_CREATED}), encoding="utf-8")
        (self.dir / "artifacts.json").write_text(json.dumps({"artifacts": artifacts}), encoding="utf-8")
        archive = self.dir / "durations.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("e2e-durations.json", '{"version": 1, "tests": []}')
        gh = self.dir / "bin" / "gh"
        gh.write_text(
            f"""#!/bin/bash
echo "$@" >> "{self.dir}/gh-args"
path="$2"
if [ -n "{fail}" ] && [[ "$path" == *{fail or "never"}* ]]; then echo "gh: HTTP 502" >&2; exit 1; fi
case "$path" in
  */actions/runs/*) jq -r "$4" "{self.dir}/run.json" ;;
  */actions/artifacts\\?*) jq -r "$4" "{self.dir}/artifacts.json" ;;
  */zip) cat "{archive}" ;;
esac
""",
            encoding="utf-8",
        )
        gh.chmod(0o755)
        (self.dir / "gh-args").write_text("", encoding="utf-8")
        completed = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(self.dir / "script.sh")],
            env={
                "PATH": f"{self.dir / 'bin'}:{os.environ['PATH']}",
                "RUNNER_TEMP": str(self.dir / "temp"),
                "REPOSITORY": "o/r",
                "RUN_ID": "99",
            },
            capture_output=True,
            text=True,
        )
        calls = (self.dir / "gh-args").read_text(encoding="utf-8").splitlines()
        downloaded = (self.dir / "temp" / "e2e-durations" / "e2e-durations.json").exists()
        return completed, calls, downloaded

    def downloads(self, calls: list[str]) -> list[str]:
        return [call.split()[1] for call in calls if call.split()[1].endswith("/zip")]

    def test_downloads_the_newest_master_artifact_created_before_the_run(self):
        completed, calls, downloaded = self.run_step([
            self.artifact(1, "2026-11-17T09:00:00Z"),
            self.artifact(3, "2026-11-18T09:00:00Z"),
            self.artifact(2, "2026-11-18T08:00:00Z"),
            self.artifact(4, "2026-11-18T10:30:00Z"),
        ])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.downloads(calls), ["repos/o/r/actions/artifacts/3/zip"])
        self.assertTrue(downloaded)
        self.assertIn("repos/o/r/actions/runs/99", calls[0])

    def test_skips_artifacts_of_forks_other_branches_and_expired_ones(self):
        completed, calls, downloaded = self.run_step([
            self.artifact(5, "2026-11-18T09:50:00Z", fork=True),
            self.artifact(6, "2026-11-18T09:40:00Z", branch="feature"),
            self.artifact(7, "2026-11-18T09:30:00Z", expired=True),
            self.artifact(8, "2026-11-18T09:00:00Z"),
        ])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.downloads(calls), ["repos/o/r/actions/artifacts/8/zip"])
        self.assertTrue(downloaded)

    def test_no_artifact_leaves_no_durations_and_passes(self):
        completed, calls, downloaded = self.run_step([self.artifact(5, "2026-11-18T09:50:00Z", fork=True)])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.downloads(calls), [])
        self.assertFalse(downloaded)

    def test_an_api_error_fails_the_step_after_three_attempts(self):
        for failing in ("actions/runs", "actions/artifacts?", "/zip"):
            with self.subTest(failing):
                completed, calls, downloaded = self.run_step([self.artifact(3, "2026-11-18T09:00:00Z")], fail=failing)
                self.assertNotEqual(completed.returncode, 0)
                self.assertFalse(downloaded)
                self.assertEqual(sum(failing in call.split()[1] for call in calls), 3, calls)


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
