"""Public read-only Venn coverage and verification boundary (no collection)."""
from __future__ import annotations

import argparse
from contextlib import closing
import json
import sqlite3
import sys
from pathlib import Path

from .quiz_schema import write_json_atomic
from .quiz_utils import reference_date_today
from .venn_coverage import generate_venn_coverage, verify_venn_coverage


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--date", default=None)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sample-output", type=Path)
    parser.add_argument("--verify-sample", type=Path, help="Check a sample against the recomputed report")
    parser.add_argument("--verify", type=Path, help="Recompute and verify report against declared database")
    args = parser.parse_args(argv)
    try:
        if not args.database.is_file():
            raise ValueError("Database does not exist")
        outputs = [p for p in (args.output, args.sample_output) if p]
        if any(p.resolve() == args.database.resolve() for p in outputs):
            raise ValueError("Output cannot overwrite the input database")
        verification_inputs = [p for p in (args.verify, args.verify_sample) if p]
        if any(out.resolve() == source.resolve() for out in outputs for source in verification_inputs):
            raise ValueError("Output cannot overwrite verification input")
        if len({p.resolve() for p in outputs}) != len(outputs):
            raise ValueError("Report and sample outputs must differ")
        with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
            if args.verify:
                report = json.loads(args.verify.read_text(encoding="utf-8"))
                verify_venn_coverage(report, connection)
            else:
                report = generate_venn_coverage(connection, args.date or reference_date_today())
        if args.verify_sample:
            sample = json.loads(args.verify_sample.read_text(encoding="utf-8"))
            if json.dumps(sample, sort_keys=True) != json.dumps(report["sample"], sort_keys=True) or sample is None:
                raise ValueError("Venn sample differs from the declared database/rules")
        text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            write_json_atomic(args.output, report, lambda value: None)
        else:
            sys.stdout.write(text)
        if args.sample_output:
            # An insufficient result must erase an earlier passing sample.
            if report["sample"] is None:
                args.sample_output.unlink(missing_ok=True)
            else:
                write_json_atomic(args.sample_output, report["sample"], lambda value: None)
        return 0 if report["status"] == "approved" else 2
    except (ValueError, TypeError, KeyError, OSError, sqlite3.Error) as exc:
        sys.stderr.write(f"Venn coverage error: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
