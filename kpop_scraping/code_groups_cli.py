"""Generate and verify a direct-access group code pilot; never writes SQLite."""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import random
import re
import sqlite3
import sys
import tempfile

from .catalog import MUSICAL_GROUP_CLASSES

VERSION = "code-groups-pilot-v1"
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
QID = re.compile(r"Q[1-9][0-9]*\Z")


def validate(puzzle: object) -> dict:
    if not isinstance(puzzle, dict) or set(puzzle) != {
        "schema_version", "mode", "puzzle_id", "dataset_version", "reference_date",
        "seed", "symbols", "secret", "max_attempts",
    }:
        raise ValueError("invalid code puzzle fields")
    if puzzle["schema_version"] != VERSION or puzzle["mode"] != "pilot":
        raise ValueError("only code-groups-pilot-v1 pilot artifacts are supported")
    if puzzle["max_attempts"] != 10 or type(puzzle["max_attempts"]) is not int:
        raise ValueError("attempt limit must be ten")
    for key in ("puzzle_id", "dataset_version", "seed", "reference_date"):
        if not isinstance(puzzle[key], str) or not puzzle[key].strip():
            raise ValueError(f"invalid {key}")
    if date.fromisoformat(puzzle["reference_date"]).isoformat() != puzzle["reference_date"]:
        raise ValueError("reference_date must be ISO YYYY-MM-DD")
    if not DIGEST.fullmatch(puzzle["dataset_version"]) or not DIGEST.fullmatch(puzzle["puzzle_id"]):
        raise ValueError("invalid dataset/puzzle hash")
    symbols = puzzle["symbols"]
    if not isinstance(symbols, list) or len(symbols) != 6:
        raise ValueError("six symbols required")
    ids = []
    for symbol in symbols:
        if not isinstance(symbol, dict) or set(symbol) != {"qid", "name", "source"}:
            raise ValueError("invalid group symbol")
        qid = symbol["qid"]
        if not isinstance(qid, str) or not QID.fullmatch(qid):
            raise ValueError("invalid group QID")
        if not isinstance(symbol["name"], str) or not symbol["name"].strip():
            raise ValueError("group name required")
        source = symbol["source"]
        if not isinstance(source, dict) or set(source) != {"revision_id", "locator", "url"}:
            raise ValueError("classification source required")
        revision = source["revision_id"]
        if type(revision) is not int or revision < 1 or source["locator"] != "claims.P31":
            raise ValueError("invalid classification evidence")
        if source["url"] != f"https://www.wikidata.org/w/index.php?title={qid}&oldid={revision}":
            raise ValueError("classification URL does not match identity/revision")
        ids.append(qid)
    if len(set(ids)) != 6:
        raise ValueError("six distinct groups required")
    secret = puzzle["secret"]
    if (not isinstance(secret, list) or len(secret) != 4
            or any(not isinstance(qid, str) or qid not in ids for qid in secret)
            or len(set(secret)) != 4):
        raise ValueError("secret must contain four distinct eligible groups")
    identity = puzzle_identity(puzzle)
    if identity != puzzle["puzzle_id"]:
        raise ValueError("puzzle identity does not match content")
    return puzzle


def puzzle_identity(puzzle: dict) -> str:
    return hashlib.sha256(json.dumps([VERSION, puzzle["dataset_version"], puzzle["reference_date"], puzzle["seed"], puzzle["symbols"], puzzle["secret"]], sort_keys=True).encode()).hexdigest()


def generate(connection: sqlite3.Connection, seed: str, reference_date: date) -> dict:
    rows = connection.execute("""
        SELECT sp.wikidata_id, sp.title, wt.external_revision_id, wt.instance_of_json
        FROM catalog_entries ce
        JOIN source_pages sp ON sp.id=ce.source_page_id
        JOIN wikidata_type_checks wt ON wt.id=ce.type_check_id
        WHERE ce.state='accepted' AND ce.analyzed_wikidata_id=sp.wikidata_id
          AND wt.wikidata_id=sp.wikidata_id
        ORDER BY sp.wikidata_id, sp.title, wt.external_revision_id DESC
    """).fetchall()
    eligible = {}
    for qid, name, revision, classes in rows:
        if (isinstance(qid, str) and QID.fullmatch(qid) and isinstance(name, str)
                and name.strip() and type(revision) is int and revision > 0):
            try:
                kinds = json.loads(classes)
                compatible = isinstance(kinds, list) and all(isinstance(x, str) for x in kinds) and bool(MUSICAL_GROUP_CLASSES.intersection(kinds))
            except (TypeError, ValueError):
                compatible = False
            if compatible:
                eligible.setdefault(qid, {"qid": qid, "name": name, "source": {
                    "revision_id": revision, "locator": "claims.P31",
                    "url": f"https://www.wikidata.org/w/index.php?title={qid}&oldid={revision}",
                }})
    if len(eligible) < 6:
        raise ValueError(f"insufficient accepted group coverage: {len(eligible)} / 6")
    vocabulary = list(eligible.values())
    dataset_version = hashlib.sha256(json.dumps(vocabulary, sort_keys=True).encode()).hexdigest()
    rng = random.Random(f"{VERSION}:{dataset_version}:{reference_date}:{seed}")
    symbols = rng.sample(vocabulary, 6)
    secret = rng.sample([s["qid"] for s in symbols], 4)
    identity = hashlib.sha256(json.dumps([VERSION, dataset_version, str(reference_date), seed, symbols, secret], sort_keys=True).encode()).hexdigest()
    return validate({"schema_version": VERSION, "mode": "pilot", "puzzle_id": identity,
        "dataset_version": dataset_version, "reference_date": str(reference_date), "seed": seed,
        "symbols": symbols, "secret": secret, "max_attempts": 10})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--date", type=date.fromisoformat)
    parser.add_argument("--seed", default="group-code-pilot")
    parser.add_argument("--verify", type=Path, metavar="ARTIFACT")
    args = parser.parse_args(argv)
    if not args.verify and (not args.database or not args.date):
        parser.error("generation requires --database and --date")
    try:
        if args.database and args.output and (args.database.resolve() == args.output.resolve()
                or (args.output.exists() and args.database.exists() and args.output.samefile(args.database))):
            raise ValueError("output must not overwrite the source database")
        if args.verify:
            puzzle = validate(json.loads(args.verify.read_text(encoding="utf-8")))
            if args.database:
                with sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True) as connection:
                    expected = generate(connection, puzzle["seed"], date.fromisoformat(puzzle["reference_date"]))
                if expected != puzzle:
                    raise ValueError("artifact differs from accepted database catalog")
            print("Group code pilot verified")
            return 0
        with sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True) as connection:
            puzzle = generate(connection, args.seed, args.date)
        content = json.dumps(puzzle, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(content)
            temporary.replace(args.output)
            print(f"Group code pilot written to {args.output}")
        else:
            print(content, end="")
        return 0
    except (OSError, ValueError, TypeError, sqlite3.Error) as exc:
        print(f"Group code pilot failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
