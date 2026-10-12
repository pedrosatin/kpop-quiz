"""Measure or independently reconstruct pairs coverage from explicit inputs."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

from .pairs_coverage import measure


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--raw-root", required=True, type=Path)
    parser.add_argument("--size", type=int, choices=(4, 5, 6), default=4)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--verify", type=Path, help="Reconstruct and compare an existing report")
    args = parser.parse_args(argv)
    try:
        if not args.database.is_file() or not args.raw_root.is_dir():
            raise ValueError("database and raw-root must exist")
        if args.output:
            protected = [args.database, args.verify] if args.verify else [args.database]
            if args.output.resolve().is_relative_to(args.raw_root.resolve()) or any(
                args.output.resolve() == p.resolve() or args.output.exists() and os.path.samefile(args.output, p)
                for p in protected
            ):
                raise ValueError("output cannot replace an input or raw snapshot")
        with sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True) as connection:
            report = measure(connection, args.raw_root, args.size)
        if args.verify:
            existing = json.loads(args.verify.read_text(encoding="utf-8"))
            if existing != report:
                raise ValueError("report differs from reconstruction against explicit inputs")
        serialized = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            name = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as stream:
                    name = stream.name
                    stream.write(serialized)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(name, args.output)
            finally:
                if name and os.path.exists(name):
                    os.unlink(name)
        else:
            sys.stdout.write(serialized)
        return 0
    except (OSError, ValueError, TypeError, sqlite3.Error) as exc:
        sys.stderr.write(f"Pairs coverage failed: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
