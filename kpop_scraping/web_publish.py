"""Publish and verify static quiz sessions consumed by the web app."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .connections_schema import validate_connections_puzzle, write_connections_puzzle_atomic
from .grid_schema import validate_intersection_grid, write_intersection_grid_atomic
from .name_guess_schema import validate_name_guess_puzzle, write_name_guess_puzzle_atomic
from .quiz_generator import QuizConfig, create_session, generate_dataset
from .quiz_schema import validate_session, write_json_atomic
from .storage import canonical_json

MANIFEST_VERSION = "kpop-quiz-web-manifest-v2"
MANIFEST_FILENAME = "manifest-v2.json"
GRID_DAILY_FILENAME = "grid.daily.json"
CONNECTIONS_DAILY_FILENAME = "connections.daily.json"
NAME_GUESS_DAILY_FILENAME = "name-guess.daily.json"
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


def _read_grid(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read grid artifact {path}: {exc}") from exc
    validate_intersection_grid(payload)
    return payload


def _read_connections(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read connections artifact {path}: {exc}") from exc
    validate_connections_puzzle(payload)
    return payload


def _read_name_guess(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read name-guess artifact {path}: {exc}") from exc
    validate_name_guess_puzzle(payload)
    return payload


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


def publish(
    output_dir: Path,
    sessions: dict[str, dict[str, Any]],
    grid: dict[str, Any] | None = None,
    connections: dict[str, Any] | None = None,
    name_guess: dict[str, Any] | None = None,
) -> None:
    """Publish static quiz sessions, optional daily grid, optional connections puzzle, and optional name-guess puzzle.

    Args:
        output_dir: Target directory where artifacts and manifest are written.
        sessions: Validated locale and difficulty quiz sessions mapping.
        grid: Optional intersection grid payload (written to grid.daily.json).
            When provided, validated against intersection grid schema before writing.
            When None, grid artifact is omitted.
        connections: Optional connections puzzle payload (written to connections.daily.json).
            When provided, validated against connections puzzle schema before writing.
            When None, connections artifact is omitted.
        name_guess: Optional name guess puzzle payload (written to name-guess.daily.json).
            When provided, validated against name guess puzzle schema before writing.
            When None, name_guess artifact is omitted.
    """
    for session in sessions.values():
        validate_session(session)
    if grid is not None:
        validate_intersection_grid(grid)
    if connections is not None:
        validate_connections_puzzle(connections)
    if name_guess is not None:
        validate_name_guess_puzzle(name_guess)
    manifest = build_manifest(sessions)
    output_dir.mkdir(parents=True, exist_ok=True)
    if grid is not None:
        write_intersection_grid_atomic(output_dir / GRID_DAILY_FILENAME, grid)
    if connections is not None:
        write_connections_puzzle_atomic(output_dir / CONNECTIONS_DAILY_FILENAME, connections)
    if name_guess is not None:
        write_name_guess_puzzle_atomic(output_dir / NAME_GUESS_DAILY_FILENAME, name_guess)
    for key in sorted(sessions):
        filename = manifest["sessions"][key]["path"]
        write_json_atomic(output_dir / filename, sessions[key], validate_session)
    write_json_atomic(output_dir / MANIFEST_FILENAME, manifest, validate_manifest)


def verify(
    output_dir: Path,
    require_grid: bool = False,
    require_connections: bool = False,
    require_name_guess: bool = False,
) -> None:
    """Verify published static quiz artifacts, manifest, grid file, connections puzzle, and name-guess puzzle.

    Args:
        output_dir: Directory containing manifest-v2.json and artifact files.
        require_grid: Verification policy flag for grid artifact (grid.daily.json).
            When False (default): backwards-compatible policy. If grid.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: grid.daily.json is mandatory and must exist and satisfy
            schema validation, raising ValueError if missing or invalid.
        require_connections: Verification policy flag for connections puzzle (connections.daily.json).
            When False (default): backwards-compatible policy. If connections.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: connections.daily.json is mandatory and must exist and satisfy
            schema validation, raising ValueError if missing or invalid.
        require_name_guess: Verification policy flag for name-guess puzzle (name-guess.daily.json).
            When False (default): backwards-compatible policy. If name-guess.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: name-guess.daily.json is mandatory and must exist and satisfy
            schema validation, raising ValueError if missing or invalid.
    """
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
    grid_path = output_dir / GRID_DAILY_FILENAME
    if grid_path.is_file():
        _read_grid(grid_path)
    elif require_grid:
        raise ValueError(f"missing required grid artifact: {grid_path}")
    connections_path = output_dir / CONNECTIONS_DAILY_FILENAME
    if connections_path.is_file():
        _read_connections(connections_path)
    elif require_connections:
        raise ValueError(f"missing required connections artifact: {connections_path}")
    name_guess_path = output_dir / NAME_GUESS_DAILY_FILENAME
    if name_guess_path.is_file():
        _read_name_guess(name_guess_path)
    elif require_name_guess:
        raise ValueError(f"missing required name-guess artifact: {name_guess_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Publish static sessions for the web app")
    parser.add_argument("--output-dir", type=Path, default=Path("web/public/data"))
    parser.add_argument("--database", type=Path)
    parser.add_argument("--seed", default="web-launch-v1")
    parser.add_argument("--date", help="Daily quiz date in ISO YYYY-MM-DD format (default: current UTC date)")
    parser.add_argument("--timer-seconds", type=int)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument(
        "--require-grid",
        action="store_true",
        help="Require grid.daily.json to exist and pass schema validation during --verify",
    )
    parser.add_argument(
        "--require-connections",
        action="store_true",
        help="Require connections.daily.json to exist and pass schema validation during --verify",
    )
    parser.add_argument(
        "--require-name-guess",
        action="store_true",
        help="Require name-guess.daily.json to exist and pass schema validation during --verify",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.require_grid and not args.verify:
            raise ValueError("--require-grid can only be used with --verify")
        if args.require_connections and not args.verify:
            raise ValueError("--require-connections can only be used with --verify")
        if args.require_name_guess and not args.verify:
            raise ValueError("--require-name-guess can only be used with --verify")
        if args.verify:
            verify(
                args.output_dir,
                require_grid=args.require_grid,
                require_connections=args.require_connections,
                require_name_guess=args.require_name_guess,
            )
        elif args.database:
            if not args.database.is_file():
                raise ValueError(f"database does not exist: {args.database}")
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
            daily_sessions = create_daily_sessions(dataset, args.date, args.timer_seconds)
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
