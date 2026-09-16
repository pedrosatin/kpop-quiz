"""Publish and verify static quiz sessions consumed by the web app."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .quiz_generator import QuizConfig, create_session, generate_dataset
from .quiz_schema import validate_session, write_json_atomic
from .storage import canonical_json

MANIFEST_VERSION = "kpop-quiz-web-manifest-v2"
MANIFEST_FILENAME = "manifest-v2.json"
LOCALES = ("pt-BR", "en")
DIFFICULTIES = ("assisted", "standard", "expert")
BASE_KEYS = {f"{locale}.{difficulty}" for locale in LOCALES for difficulty in DIFFICULTIES}
DAILY_KEYS = {f"daily.{locale}.{difficulty}" for locale in LOCALES for difficulty in DIFFICULTIES}
VALID_KEY_SETS = (BASE_KEYS, DAILY_KEYS, BASE_KEYS | DAILY_KEYS)


def _read_session(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read session {path}: {exc}") from exc
    validate_session(payload)
    return payload


def _session_bytes(session: dict[str, Any]) -> bytes:
    validate_session(session)
    return canonical_json(session) + b"\n"


def parse_daily_date(date_str: str | None) -> str:
    """Validate ISO YYYY-MM-DD date or return current UTC date."""
    if date_str is None:
        return datetime.now(timezone.utc).date().isoformat()
    try:
        parsed = date.fromisoformat(date_str)
        if len(date_str) != 10 or parsed.isoformat() != date_str:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise ValueError(f"invalid ISO date format (expected YYYY-MM-DD): {date_str}") from exc
    return date_str


def create_daily_sessions(
    dataset: dict[str, Any],
    date_str: str | None = None,
    timer_seconds: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Create deterministic daily quiz sessions for all locales and difficulties."""
    iso_date = parse_daily_date(date_str)
    seed = f"kpop-daily-{iso_date}"
    return {
        f"daily.{locale}.{difficulty}": create_session(
            dataset,
            QuizConfig(locale, seed, play_mode=difficulty, timer_seconds=timer_seconds),
        )
        for locale in LOCALES
        for difficulty in DIFFICULTIES
    }


def build_manifest(sessions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Describe validated locale sessions with hashes for deployment checks."""
    versions = {session["dataset_version"] for session in sessions.values()}
    if set(sessions) not in VALID_KEY_SETS or len(versions) != 1:
        raise ValueError("web publication requires every locale and difficulty from one dataset")
    for key, session in sessions.items():
        if key.startswith("daily."):
            _, locale, difficulty = key.split(".", 2)
        else:
            locale, difficulty = key.split(".", 1)
        if session["config"]["language"] != locale:
            raise ValueError(f"session language does not match {locale}")
        if session["config"]["play_mode"] != difficulty:
            raise ValueError(f"session play mode does not match {difficulty}")
    if BASE_KEYS.issubset(set(sessions)):
        for locale in LOCALES:
            _validate_mode_sessions(
                {mode: sessions[f"{locale}.{mode}"] for mode in DIFFICULTIES}
            )
    if DAILY_KEYS.issubset(set(sessions)):
        for locale in LOCALES:
            _validate_mode_sessions(
                {mode: sessions[f"daily.{locale}.{mode}"] for mode in DIFFICULTIES}
            )
    manifest = {
        "schema_version": MANIFEST_VERSION,
        "dataset_version": versions.pop(),
        "sessions": {},
    }
    for key in sorted(sessions):
        digest = hashlib.sha256(_session_bytes(sessions[key])).hexdigest()
        manifest["sessions"][key] = {
            "path": f"session.{key}.{digest}.json",
            "sha256": digest,
            "session_id": sessions[key]["session_id"],
        }
    return manifest


def _validate_mode_sessions(sessions: dict[str, dict[str, Any]]) -> None:
    """Reject publications whose modes do not contain the same quiz round."""
    standard = sessions["standard"]
    ignored = {
        "base_points", "clues_available", "clues_shown", "hint_cost", "id", "play_mode"
    }
    expected = [
        {key: value for key, value in question.items() if key not in ignored}
        for question in standard["questions"]
    ]
    for mode, session in sessions.items():
        if session["config"]["seed"] != standard["config"]["seed"]:
            raise ValueError(f"session seed does not match standard mode for {mode}")
        actual = [
            {key: value for key, value in question.items() if key not in ignored}
            for question in session["questions"]
        ]
        if actual != expected:
            raise ValueError(f"session questions do not match standard mode for {mode}")


def validate_manifest(payload: dict[str, Any]) -> None:
    if set(payload) != {"schema_version", "dataset_version", "sessions"}:
        raise ValueError("invalid web manifest fields")
    if payload["schema_version"] != MANIFEST_VERSION:
        raise ValueError("invalid web manifest schema_version")
    dataset_version = payload["dataset_version"]
    if not isinstance(dataset_version, str) or len(dataset_version) != 64 or any(c not in "0123456789abcdef" for c in dataset_version):
        raise ValueError("invalid web manifest dataset_version")
    sessions = payload["sessions"]
    if not isinstance(sessions, dict) or set(sessions) not in VALID_KEY_SETS:
        raise ValueError("invalid web manifest sessions")
    for key in sorted(sessions):
        item = sessions[key]
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "session_id"}:
            raise ValueError(f"invalid web manifest session {key}")
        for field in ("sha256", "session_id"):
            value = item[field]
            if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
                raise ValueError(f"invalid web manifest {field} {key}")
        if item["path"] != f"session.{key}.{item['sha256']}.json":
            raise ValueError(f"invalid web manifest path {key}")


def publish(output_dir: Path, sessions: dict[str, dict[str, Any]]) -> None:
    for session in sessions.values():
        validate_session(session)
    manifest = build_manifest(sessions)
    output_dir.mkdir(parents=True, exist_ok=True)
    for key in sorted(sessions):
        filename = manifest["sessions"][key]["path"]
        write_json_atomic(output_dir / filename, sessions[key], validate_session)
    write_json_atomic(output_dir / MANIFEST_FILENAME, manifest, validate_manifest)


def verify(output_dir: Path) -> None:
    manifest_path = output_dir / MANIFEST_FILENAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read web manifest: {exc}") from exc
    validate_manifest(manifest)
    sessions = {
        key: _read_session(output_dir / manifest["sessions"][key]["path"])
        for key in sorted(manifest["sessions"])
    }
    expected = build_manifest(sessions)
    if manifest != expected:
        raise ValueError("web artifacts do not match manifest")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Publish static sessions for the web app")
    parser.add_argument("--output-dir", type=Path, default=Path("web/public/data"))
    parser.add_argument("--database", type=Path)
    parser.add_argument("--seed", default="web-launch-v1")
    parser.add_argument("--date", help="Daily quiz date in ISO YYYY-MM-DD format (default: current UTC date)")
    parser.add_argument("--timer-seconds", type=int)
    parser.add_argument("--verify", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.verify:
            verify(args.output_dir)
        elif args.database:
            if not args.database.is_file():
                raise ValueError(f"database does not exist: {args.database}")
            date_str = parse_daily_date(args.date)
            daily_seed = f"kpop-daily-{date_str}"
            connection = sqlite3.connect(f"{args.database.resolve().as_uri()}?mode=ro", uri=True)
            connection.row_factory = sqlite3.Row
            try:
                dataset, _ = generate_dataset(connection)
            finally:
                connection.close()
            base_sessions = {
                f"{locale}.{difficulty}": create_session(
                    dataset,
                    QuizConfig(locale, args.seed, play_mode=difficulty, timer_seconds=args.timer_seconds),
                )
                for locale in LOCALES for difficulty in DIFFICULTIES
            }
            daily_sessions = {
                f"daily.{locale}.{difficulty}": create_session(
                    dataset,
                    QuizConfig(locale, daily_seed, play_mode=difficulty, timer_seconds=args.timer_seconds),
                )
                for locale in LOCALES for difficulty in DIFFICULTIES
            }
            sessions = {**base_sessions, **daily_sessions}
            publish(args.output_dir, sessions)
        else:
            raise ValueError("provide --database or --verify")
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(f"Web publication failed: {exc}")
        return 1
    print(f"Web artifacts {'verified' if args.verify else 'published'} in {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
