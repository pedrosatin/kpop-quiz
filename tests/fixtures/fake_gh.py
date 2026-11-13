"""Stand-in for the ``gh`` executable, used by ``tests/test_publish_via_pr.py``.

It keeps a small GitHub in the JSON file named by ``FAKE_GH_STATE`` and answers
the three commands ``scripts/publish_via_pr.py`` runs:

* ``pr list`` returns the open pull requests whose head branch has the asked
  name, in the stored order and from any repository, as the real command does.
* ``pr create`` opens a pull request of the repository itself at the SHA its
  branch has in ``branches``, and refuses a second one for the same branch.
* ``pr merge`` merges whatever the head is at that moment, unless
  ``--match-head-commit`` names another SHA.

State keys that script a scenario:

* ``push_before_merge``: SHA pushed to the pull request between the listing
  and the merge.
* ``pending_head`` and ``pending_listings`` on a pull request: the head GitHub
  shows only after that many listings.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any


def option(args: list[str], name: str, default: str | None = None) -> str | None:
    return args[args.index(name) + 1] if name in args else default


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def pr_list(state: dict[str, Any], args: list[str]) -> int:
    for pull_request in state["pull_requests"]:
        if "pending_head" not in pull_request:
            continue
        if pull_request.get("pending_listings", 0) > 0:
            pull_request["pending_listings"] -= 1
        else:
            pull_request["headRefOid"] = pull_request.pop("pending_head")
    fields = (option(args, "--json") or "number").split(",")
    listed = [
        {field: pull_request.get(field) for field in fields}
        for pull_request in state["pull_requests"]
        if pull_request["state"] == "OPEN"
        and pull_request["headRefName"] == option(args, "--head")
        and option(args, "--base") in (None, pull_request["baseRefName"])
    ]
    print(json.dumps(listed[: int(option(args, "--limit", "30"))]))
    return 0


def pr_create(state: dict[str, Any], args: list[str]) -> int:
    head, base = option(args, "--head"), option(args, "--base")
    owner, name = state["repository"].split("/")
    if head not in state["branches"]:
        return fail(f"GraphQL: Head sha can't be blank, No commits between {base} and {head}")
    for pull_request in state["pull_requests"]:
        if (
            pull_request["state"] == "OPEN"
            and not pull_request["isCrossRepository"]
            and pull_request["headRefName"] == head
            and pull_request["baseRefName"] == base
        ):
            return fail(f'a pull request for branch "{head}" into branch "{base}" already exists')
    number = max((item["number"] for item in state["pull_requests"]), default=0) + 1
    state["pull_requests"].append({
        "number": number,
        "state": "OPEN",
        "title": option(args, "--title"),
        "headRefName": head,
        "headRefOid": state["branches"][head],
        "baseRefName": base,
        "isCrossRepository": False,
        "headRepository": {"name": name},
        "headRepositoryOwner": {"login": owner},
    })
    print(f"https://github.com/{state['repository']}/pull/{number}")
    return 0


def pr_merge(state: dict[str, Any], args: list[str]) -> int:
    number = int(args[0])
    pull_request = next(
        (item for item in state["pull_requests"] if item["number"] == number and item["state"] == "OPEN"),
        None,
    )
    if pull_request is None:
        return fail(f"GraphQL: Could not resolve to a PullRequest with the number of {number}.")
    if state.get("push_before_merge"):
        pull_request["headRefOid"] = state["push_before_merge"]
    expected = option(args, "--match-head-commit")
    if expected and expected != pull_request["headRefOid"]:
        return fail("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)")
    pull_request["state"] = "MERGED"
    state["merged"].append({
        "number": number,
        "sha": pull_request["headRefOid"],
        "cross_repository": pull_request["isCrossRepository"],
        "subject": option(args, "--subject"),
    })
    if "--delete-branch" in args and not pull_request["isCrossRepository"]:
        state["branches"].pop(pull_request["headRefName"], None)
    return 0


COMMANDS = {"list": pr_list, "create": pr_create, "merge": pr_merge}


def main(argv: list[str]) -> int:
    path = os.environ["FAKE_GH_STATE"]
    with open(path, encoding="utf-8") as handle:
        state = json.load(handle)
    state.setdefault("calls", []).append(argv)
    state.setdefault("merged", [])
    if len(argv) < 2 or argv[0] != "pr" or argv[1] not in COMMANDS:
        code = fail(f"fake gh does not implement: {' '.join(argv)}")
    elif option(argv, "--repo") != state["repository"]:
        code = fail(f"fake gh expected --repo {state['repository']}")
    else:
        code = COMMANDS[argv[1]](state, argv[2:])
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
