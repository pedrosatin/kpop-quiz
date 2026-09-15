"""Command-line export for the static quiz dataset and sessions."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date
from pathlib import Path

from .quiz_generator import (
    DEFAULT_REFERENCE_DATE,
    InsufficientQuestionsError,
    QuizConfig,
    create_session,
    generate_dataset,
)
from .quiz_schema import (
    validate_dataset,
    validate_report,
    validate_session,
    write_json_atomic,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate sourced K-pop quiz JSON")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--reference-date", type=date.fromisoformat, default=DEFAULT_REFERENCE_DATE)
    parser.add_argument("--languages", nargs="+", choices=("pt-BR", "en"), default=("pt-BR", "en"))
    parser.add_argument("--session-output", type=Path)
    parser.add_argument("--session-language", choices=("pt-BR", "en"), default="pt-BR")
    parser.add_argument("--seed", default="kpop-quiz-v1")
    parser.add_argument("--theme")
    parser.add_argument("--group")
    parser.add_argument(
        "--play-mode",
        choices=("assisted", "standard", "expert"),
        default="standard",
    )
    parser.add_argument("--timer-seconds", type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.timer_seconds is not None and args.timer_seconds < 1:
        raise SystemExit("--timer-seconds must be greater than zero")
    if not args.database.is_file():
        raise SystemExit(f"database does not exist: {args.database}")
    connection = sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        dataset, report = generate_dataset(
            connection, reference_date=args.reference_date, languages=args.languages
        )
    except (sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
        print(f"Quiz generation failed: {type(exc).__name__}: {exc}")
        return 1
    finally:
        connection.close()
    session_count = 0
    session = None
    if args.session_output:
        try:
            session = create_session(
                dataset,
                QuizConfig(
                    language=args.session_language,
                    seed=args.seed,
                    theme=args.theme,
                    group_id=args.group,
            play_mode=args.play_mode,
                    timer_seconds=args.timer_seconds,
                ),
            )
        except (InsufficientQuestionsError, ValueError) as exc:
            print(f"Session generation failed: {exc}")
            return 1
        session_count = len(session["questions"])
    try:
        write_json_atomic(args.output, dataset, validate_dataset)
        write_json_atomic(args.report, report, validate_report)
        if args.session_output and session is not None:
            write_json_atomic(args.session_output, session, validate_session)
    except OSError as exc:
        print(f"Quiz export failed: {type(exc).__name__}: {exc}")
        return 1
    print(
        f"Quiz: {report['accepted_logical']} logical questions, "
        f"{report['language_variants']} language variants, {session_count} session questions"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
