"""Refuse a downloaded artifact that holds files its publish job does not publish.

The publish jobs of ``daily-puzzles-cron.yml`` and ``map-pilot-refresh.yml``
copy the whole artifact directory into the checkout and commit it. The
verifiers that run before the commit read only the files they know, so an
extra file would reach ``master`` unchecked. This check runs first:

- ``--suffix .json`` accepts regular files whose name ends with the suffix,
  at any depth (the daily set and ``next/``);
- ``--only NAME`` accepts exactly the listed paths, relative to the
  directory, and nothing else.

Symbolic links and other special files are refused under either rule, since
``cp -a`` keeps them and ``git add`` would commit the link. The command
exits with 0 when every entry passes and with 1 otherwise, listing the
refused paths in one escaped annotation. Importing the module does nothing.
"""

from __future__ import annotations

import argparse
import os
from collections.abc import Sequence
from pathlib import Path

from . import workflow_commands

MAX_LISTED = 20

def refused_entries(directory: Path, *, suffix: str | None = None, only: Sequence[str] = ()) -> list[str]:
    """Return the relative paths under ``directory`` the rule refuses, sorted."""
    if (suffix is None) == (not only):
        raise ValueError("pass exactly one of suffix or only")
    allowed = set(only)
    refused = []
    for folder, subfolders, names in os.walk(directory):
        base = Path(folder)
        for name in subfolders:
            if (base / name).is_symlink():
                refused.append((base / name).relative_to(directory).as_posix())
        subfolders[:] = [name for name in subfolders if not (base / name).is_symlink()]
        for name in names:
            path = base / name
            relative = path.relative_to(directory).as_posix()
            regular = path.is_file() and not path.is_symlink()
            matches = name.endswith(suffix) if suffix is not None else relative in allowed
            if not (regular and matches):
                refused.append(relative)
    return sorted(refused)

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("directory", type=Path)
    rule = parser.add_mutually_exclusive_group(required=True)
    rule.add_argument("--suffix", help="Accept regular files whose name ends with this suffix")
    rule.add_argument("--only", action="append", default=[], help="Accept this relative path; repeatable")
    args = parser.parse_args(argv)
    if not args.directory.is_dir():
        workflow_commands.error(f"{args.directory} is not a directory", title="Unexpected files in the artifact")
        return 1
    refused = refused_entries(args.directory, suffix=args.suffix, only=args.only)
    if refused:
        listed = ", ".join(refused[:MAX_LISTED])
        more = len(refused) - MAX_LISTED
        if more > 0:
            listed += f" and {more} more"
        workflow_commands.error(
            f"{args.directory} holds {len(refused)} file(s) the publish job does not publish: {listed}",
            title="Unexpected files in the artifact",
        )
        return 1
    rule_text = f"*{args.suffix}" if args.suffix is not None else ", ".join(args.only)
    print(f"Checked {args.directory}: every file matches {rule_text}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
