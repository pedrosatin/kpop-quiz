#!/usr/bin/env python3
"""Merge the pull request of the commit a publication job just pushed.

``daily-puzzles-cron`` and ``map-pilot-refresh`` publish through a pull request
that the job merges itself, because the ruleset on ``master`` only accepts
changes that arrive that way. The repository is public, so anyone can open a
pull request from a fork whose branch carries the automation branch's name.
The job merges a pull request only when all of these hold:

* its head branch lives in this repository (``isCrossRepository`` is false and
  the head repository is this one);
* it goes from the automation branch into the base branch;
* its head is the commit the job pushed.

When no pull request of this repository exists for the branch, the job opens
its own. The merge carries ``--match-head-commit``, so GitHub refuses it when
the head moved after the check.
``docs/decisions/031-self-merge-so-do-commit-enviado.md`` records the rule.

Run it after ``git push`` of the generated commit::

    python3 scripts/publish_via_pr.py --repo owner/name \
        --branch automation/daily-puzzles --head-sha "$(git rev-parse HEAD)" \
        --title "Publish daily puzzles for 2026-11-13" --body "..."

Importing the module runs nothing: ``gh`` is only called from ``publish``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Sequence

# The workflows run this file as scripts/publish_via_pr.py, which puts
# scripts/ on sys.path; the shared annotation helper lives in the package.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kpop_scraping import workflow_commands  # noqa: E402

GH_TIMEOUT_SECONDS = 120
# gh lists 30 pull requests by default. Forks can open that many under the
# automation branch's name, which would hide this repository's own.
LIST_LIMIT = 100
LIST_FIELDS = (
    "number,headRefName,headRefOid,baseRefName,"
    "isCrossRepository,headRepository,headRepositoryOwner"
)
# GitHub updates a pull request's head a moment after the push, and lists a
# new pull request a moment after creating it.
DEFAULT_ATTEMPTS = 5
DEFAULT_RETRY_DELAY_SECONDS = 3.0

_FULL_SHA = re.compile(r"[0-9a-f]{40}")
_REPOSITORY = re.compile(r"[^/\s]+/[^/\s]+")

GhRunner = Callable[[Sequence[str]], str]


class PublishError(RuntimeError):
    """The pull request could not be opened or merged under the rule."""


def run_gh(args: Sequence[str]) -> str:
    """Run ``gh`` with a timeout and return its stdout."""
    command = " ".join(["gh", *args[:2]])
    try:
        completed = subprocess.run(
            ["gh", *args],
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError as error:
        raise PublishError("gh is not installed or not on PATH") from error
    except subprocess.TimeoutExpired as error:
        raise PublishError(f"{command} did not answer in {GH_TIMEOUT_SECONDS}s") from error
    if completed.returncode != 0:
        raise PublishError(
            f"{command} failed with exit {completed.returncode}: {completed.stderr.strip()}"
        )
    return completed.stdout


def _head_repository(pull_request: dict[str, Any]) -> str | None:
    # A deleted fork leaves both fields null.
    owner = (pull_request.get("headRepositoryOwner") or {}).get("login")
    name = (pull_request.get("headRepository") or {}).get("name")
    if not owner or not name:
        return None
    return f"{owner}/{name}"


def own_pull_requests(
    pull_requests: Sequence[dict[str, Any]], *, repository: str, branch: str, base: str
) -> list[dict[str, Any]]:
    """Keep the pull requests that go from ``branch`` of ``repository`` itself into ``base``.

    The position in the list never decides: a fork's pull request is dropped
    wherever it appears.
    """
    own = []
    for pull_request in pull_requests:
        head_repository = _head_repository(pull_request)
        if (
            pull_request.get("isCrossRepository") is False
            and head_repository is not None
            and head_repository.casefold() == repository.casefold()
            and pull_request.get("headRefName") == branch
            and pull_request.get("baseRefName") == base
        ):
            own.append(pull_request)
    return own


def list_pull_requests(
    run: GhRunner, *, repository: str, branch: str, base: str
) -> list[dict[str, Any]]:
    output = run([
        "pr", "list", "--repo", repository, "--head", branch, "--base", base,
        "--state", "open", "--limit", str(LIST_LIMIT), "--json", LIST_FIELDS,
    ])
    try:
        pull_requests = json.loads(output)
    except json.JSONDecodeError as error:
        raise PublishError("gh pr list did not return JSON") from error
    if not isinstance(pull_requests, list):
        raise PublishError("gh pr list did not return a list of pull requests")
    return [item for item in pull_requests if isinstance(item, dict)]


def find_pull_request(
    run: GhRunner,
    *,
    repository: str,
    branch: str,
    base: str,
    head_sha: str,
    required: bool,
    attempts: int,
    retry_delay: float,
    sleep: Callable[[float], None],
) -> int | None:
    """Return this repository's pull request whose head is ``head_sha``.

    Returns ``None`` when the repository has no pull request for the branch and
    ``required`` is false, which tells the caller to open one. A pull request of
    this repository with another head is listed again, because GitHub may not
    have applied the push yet; if the head never becomes ``head_sha``, either
    someone else pushed to the branch or GitHub is slower than the listings
    wait, and the publication stops.
    """
    other_heads: list[str] = []
    for attempt in range(attempts):
        if attempt:
            sleep(retry_delay)
        own = own_pull_requests(
            list_pull_requests(run, repository=repository, branch=branch, base=base),
            repository=repository, branch=branch, base=base,
        )
        for pull_request in own:
            if pull_request.get("headRefOid") == head_sha:
                return int(pull_request["number"])
        other_heads = [
            f"#{pull_request.get('number')} at {pull_request.get('headRefOid')}"
            for pull_request in own
        ]
        if not own and not required:
            return None
    if other_heads:
        raise PublishError(
            f"The pull request of {repository} for {branch} is {', '.join(other_heads)}, "
            f"not the pushed commit {head_sha} after {attempts} listings. Another push reached "
            "the branch, or GitHub has not applied the push yet; nothing was merged."
        )
    raise PublishError(
        f"No pull request of {repository} from {branch} into {base} has the pushed commit {head_sha}."
    )


def publish(
    *,
    repository: str,
    branch: str,
    base: str,
    head_sha: str,
    title: str,
    body: str,
    run: GhRunner = run_gh,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = DEFAULT_ATTEMPTS,
    retry_delay: float = DEFAULT_RETRY_DELAY_SECONDS,
) -> int:
    """Open (or reuse) this job's pull request for ``head_sha`` and squash-merge it."""
    # An empty --match-head-commit makes gh merge whatever the head is.
    if not _FULL_SHA.fullmatch(head_sha):
        raise PublishError(f"Expected the pushed commit as a full 40-character SHA, got {head_sha!r}")
    if not _REPOSITORY.fullmatch(repository):
        raise PublishError(f"Expected the repository as OWNER/NAME, got {repository!r}")
    if attempts < 1:
        raise PublishError("attempts must be at least 1")
    search = dict(
        repository=repository, branch=branch, base=base, head_sha=head_sha,
        attempts=attempts, retry_delay=retry_delay, sleep=sleep,
    )
    number = find_pull_request(run, required=False, **search)
    if number is None:
        run([
            "pr", "create", "--repo", repository, "--head", branch, "--base", base,
            "--title", title, "--body", body,
        ])
        number = find_pull_request(run, required=True, **search)
        print(f"Opened pull request #{number} for {head_sha}", flush=True)
    else:
        print(f"Reusing pull request #{number}, already at {head_sha}", flush=True)
    run([
        "pr", "merge", str(number), "--repo", repository, "--squash",
        "--subject", title, "--body", "", "--delete-branch",
        "--match-head-commit", head_sha,
    ])
    print(f"Merged pull request #{number} at {head_sha}", flush=True)
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Open this job's pull request for the pushed commit and merge only that commit."
    )
    parser.add_argument(
        "--repo", default=os.environ.get("GITHUB_REPOSITORY", ""),
        help="Repository as OWNER/NAME (default: $GITHUB_REPOSITORY)",
    )
    parser.add_argument("--branch", required=True, help="Automation branch the job pushed to")
    parser.add_argument("--base", default="master", help="Branch that receives the merge")
    parser.add_argument("--head-sha", required=True, help="Full SHA of the commit the job pushed")
    parser.add_argument("--title", required=True, help="Pull request title and squash subject")
    parser.add_argument("--body", default="", help="Pull request body")
    parser.add_argument(
        "--attempts", type=int, default=DEFAULT_ATTEMPTS,
        help="Listings to wait for GitHub to show the pushed head",
    )
    parser.add_argument(
        "--retry-delay", type=float, default=DEFAULT_RETRY_DELAY_SECONDS,
        help="Seconds between listings",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        publish(
            repository=args.repo, branch=args.branch, base=args.base,
            head_sha=args.head_sha, title=args.title, body=args.body,
            attempts=args.attempts, retry_delay=args.retry_delay,
        )
    except PublishError as error:
        # The message can quote the stderr of gh.
        workflow_commands.error(str(error), stream=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
