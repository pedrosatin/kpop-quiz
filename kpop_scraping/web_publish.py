"""Publish and verify static quiz sessions consumed by the web app."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .code_groups_cli import validate as validate_code_groups_puzzle
from .crossword_daily import validate_published as validate_crossword_daily
from .crossword_publication import read_record as read_crossword_record
from .crossword_publication import verify_history as verify_crossword_history
from .daily_set import DAILY_SET_FILENAME, read_daily_set
from .connections_schema import validate_connections_puzzle, write_connections_puzzle_atomic
from .grid_schema import validate_intersection_grid, write_intersection_grid_atomic
from .name_guess_schema import validate_name_guess_puzzle, write_name_guess_puzzle_atomic
from .quiz_generator import QuizConfig, generate_dataset
from .quiz_session import create_session
from .quiz_clue_coverage import published_clue_coverage_lines
from .quiz_models import InsufficientQuestionsError
from .quiz_catalog import (
    CATALOG_MANIFEST_FILENAME,
    build_catalog,
    publish_catalog,
    published_catalog_coverage_lines,
    read_catalog,
    validate_sessions_in_catalog,
)
from .quiz_schema import (
    mode_neutral_question,
    validate_legacy_clues,
    validate_session,
    write_json_atomic,
)
from .storage import canonical_json
from .timeline_schema import validate_timeline_puzzle, write_timeline_puzzle_atomic
from .word_search_schema import (
    validate_word_search_puzzle,
    write_word_search_puzzle_atomic,
)

MANIFEST_VERSION = "kpop-quiz-web-manifest-v2"
MANIFEST_FILENAME = "manifest-v2.json"
# Same shape as the v2 manifest, but it names the sessions that carry related
# decade clues. Clients released before those clues existed only ever read the
# v2 manifest, so they never meet a session they would reject; clients that
# accept them read this one first and fall back to v2 when it is absent.
ENRICHED_MANIFEST_VERSION = "kpop-quiz-web-manifest-v3"
ENRICHED_MANIFEST_FILENAME = "manifest-v3.json"
GRID_DAILY_FILENAME = "grid.daily.json"
CONNECTIONS_DAILY_FILENAME = "connections.daily.json"
NAME_GUESS_DAILY_FILENAME = "name-guess.daily.json"
WORD_SEARCH_DAILY_FILENAME = "word-search.daily.json"
TIMELINE_DAILY_FILENAME = "timeline.daily.json"
CODE_GROUPS_DAILY_FILENAME = "code-groups.daily.json"
CROSSWORD_DAILY_FILENAME = "crossword.daily.json"
SESSION_SHORTCUT_FILENAMES = ("session.pt-BR.json", "session.en.json")
# Seed of the daily quiz sessions, followed by their date.
DAILY_SEED_PREFIX = "kpop-daily-"
# The file whose presence publishes each game of a daily set. The quiz is
# its manifest: without manifest-v2.json no session is offered.
DAILY_GAME_FILES = {
    "quiz": MANIFEST_FILENAME,
    "grid": GRID_DAILY_FILENAME,
    "connections": CONNECTIONS_DAILY_FILENAME,
    "name-guess": NAME_GUESS_DAILY_FILENAME,
    "word-search": WORD_SEARCH_DAILY_FILENAME,
    "timeline": TIMELINE_DAILY_FILENAME,
    "code-groups": CODE_GROUPS_DAILY_FILENAME,
    "crossword": CROSSWORD_DAILY_FILENAME,
}
# Every file a daily set may hold for its games, besides the hash-named
# sessions. A set that omits one must not keep an earlier day's copy.
DAILY_SET_FILES = (
    *DAILY_GAME_FILES.values(),
    ENRICHED_MANIFEST_FILENAME,
    *SESSION_SHORTCUT_FILENAMES,
    DAILY_SET_FILENAME,
)
LOCALES = ("pt-BR", "en")
DIFFICULTIES = ("assisted", "standard", "expert")
BASE_KEYS = {f"{locale}.{difficulty}" for locale in LOCALES for difficulty in DIFFICULTIES}
DAILY_KEYS = {f"daily.{locale}.{difficulty}" for locale in LOCALES for difficulty in DIFFICULTIES}
VALID_KEY_SETS = (BASE_KEYS, DAILY_KEYS, BASE_KEYS | DAILY_KEYS)
DECADES = (1990, 2000, 2010, 2020)


def _is_session_key(key: str) -> bool:
    parts = key.split(".")
    if len(parts) == 2:
        return key in BASE_KEYS
    if len(parts) == 3:
        return key in DAILY_KEYS
    return (
        len(parts) == 4 and parts[0] == "decade" and parts[1] in {str(value) for value in DECADES}
        and parts[2] in LOCALES and parts[3] in DIFFICULTIES
    )


def _valid_session_keys(keys: set[str]) -> bool:
    if not keys or not all(_is_session_key(key) for key in keys):
        return False
    for decade in DECADES:
        decade_keys = {f"decade.{decade}.{locale}.{mode}" for locale in LOCALES for mode in DIFFICULTIES}
        if keys & decade_keys and not decade_keys <= keys:
            return False
    return keys & (BASE_KEYS | DAILY_KEYS) in VALID_KEY_SETS


@contextmanager
def _located(path: Path):
    """Name ``path`` in a verification error whose message lacks it."""
    try:
        yield
    except ValueError as exc:
        if str(path) in str(exc):
            raise
        raise ValueError(f"{path}: {exc}") from exc


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


def _read_word_search(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read word-search artifact {path}: {exc}") from exc
    validate_word_search_puzzle(payload)
    return payload


def _read_timeline(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read timeline artifact {path}: {exc}") from exc
    validate_timeline_puzzle(payload)
    return payload


def _read_code_groups(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read code-groups artifact {path}: {exc}") from exc
    validate_code_groups_puzzle(payload)
    return payload


def _read_crossword(path: Path) -> dict[str, Any]:
    """Read crossword.daily.json and check it against the record of its day.

    The factual matching and the proof search need the fact base, which a
    published directory does not carry; the daily runner recomputes them
    before writing. Here the artifact must pass every rule that needs no
    base and agree with the durable record published beside it.
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read crossword artifact {path}: {exc}") from exc
    validate_crossword_daily(payload)
    record = read_crossword_record(path.parent, payload["reference_date"])
    if record is None:
        raise ValueError(f"crossword artifact {path} has no publication record")
    published = payload["puzzle"]["vocabulary"] if payload["puzzle"] else []
    if (
        record["source"] != "daily"
        or record["dataset_version"] != payload["dataset_version"]
        or record["base_id"] != payload["base_id"]
        or record["previous"] != payload["previous"]
        or record["qids"] != published
    ):
        raise ValueError(f"crossword artifact {path} disagrees with its publication record")
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
    seed = f"{DAILY_SEED_PREFIX}{iso_date}"
    return {
        f"daily.{locale}.{difficulty}": create_session(
            dataset,
            QuizConfig(locale, seed, play_mode=difficulty, timer_seconds=timer_seconds),
        )
        for locale in LOCALES
        for difficulty in DIFFICULTIES
    }


def create_decade_sessions(dataset: dict[str, Any], seed: str, timer_seconds: int | None = None) -> dict[str, dict[str, Any]]:
    """Create every complete decade collection that the current dataset can fill."""
    sessions: dict[str, dict[str, Any]] = {}
    for decade in DECADES:
        try:
            collection = {
                f"decade.{decade}.{locale}.{difficulty}": create_session(
                    dataset,
                    QuizConfig(locale, f"{seed}-decade-{decade}", play_mode=difficulty,
                               timer_seconds=timer_seconds, decade=decade),
                )
                for locale in LOCALES for difficulty in DIFFICULTIES
            }
        except InsufficientQuestionsError:
            continue
        sessions.update(collection)
    return sessions


def build_manifest(
    sessions: dict[str, dict[str, Any]], schema_version: str = MANIFEST_VERSION
) -> dict[str, Any]:
    """Describe validated locale sessions with hashes for deployment checks."""
    versions = {session["dataset_version"] for session in sessions.values()}
    if not _valid_session_keys(set(sessions)) or len(versions) != 1:
        raise ValueError("web publication requires every locale and difficulty from one dataset")
    for key, session in sessions.items():
        if key.startswith("daily."):
            _, locale, difficulty = key.split(".", 2)
        elif key.startswith("decade."):
            _, decade, locale, difficulty = key.split(".", 3)
            if session["config"].get("decade") != int(decade):
                raise ValueError(f"session decade does not match {decade}")
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
    for decade in DECADES:
        decade_keys = {f"decade.{decade}.{locale}.{mode}" for locale in LOCALES for mode in DIFFICULTIES}
        if decade_keys <= set(sessions):
            for locale in LOCALES:
                _validate_mode_sessions(
                    {mode: sessions[f"decade.{decade}.{locale}.{mode}"] for mode in DIFFICULTIES}
                )
    manifest = {
        "schema_version": schema_version,
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
    """Keep a common round seed while allowing relevance-specific question pools."""
    standard = sessions["standard"]
    standard_by_logical_id = {
        question["logical_id"]: question for question in standard["questions"]
    }
    if len(standard_by_logical_id) != len(standard["questions"]):
        raise ValueError("standard session repeats a logical question")
    for mode, session in sessions.items():
        if session["config"]["seed"] != standard["config"]["seed"]:
            raise ValueError(f"session seed does not match standard mode for {mode}")
        questions_by_logical_id = {
            question["logical_id"]: question for question in session["questions"]
        }
        if len(questions_by_logical_id) != len(session["questions"]):
            raise ValueError(f"session repeats a logical question for {mode}")
        for logical_id in sorted(set(standard_by_logical_id) & set(questions_by_logical_id)):
            standard_question = standard_by_logical_id[logical_id]
            expected = mode_neutral_question(standard_question, standard_question)
            actual = mode_neutral_question(
                questions_by_logical_id[logical_id], standard_question
            )
            if actual != expected:
                raise ValueError(f"session questions do not match standard mode for {mode}")


def validate_manifest(payload: dict[str, Any], schema_version: str = MANIFEST_VERSION) -> None:
    if set(payload) != {"schema_version", "dataset_version", "sessions"}:
        raise ValueError("invalid web manifest fields")
    if payload["schema_version"] != schema_version:
        raise ValueError("invalid web manifest schema_version")
    dataset_version = payload["dataset_version"]
    if not isinstance(dataset_version, str) or len(dataset_version) != 64 or any(c not in "0123456789abcdef" for c in dataset_version):
        raise ValueError("invalid web manifest dataset_version")
    sessions = payload["sessions"]
    if not isinstance(sessions, dict) or not _valid_session_keys(set(sessions)):
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


def validate_enrichment(
    legacy: dict[str, dict[str, Any]], enriched: dict[str, dict[str, Any]]
) -> None:
    """Require the enriched sessions to differ from the legacy ones only by clues.

    Identity stays put: the same sessions, in the same order, with the same
    question ids, answers, options and evidence. The saved games and the daily
    result of a player key on those ids, so a clue added to a question must
    never move them. A question that already had a clue keeps it unchanged,
    and the expert sessions, which never offer clues, stay byte-identical.
    """
    if set(legacy) != set(enriched):
        raise ValueError("enriched sessions must cover the same keys as the legacy ones")
    clue_fields = {"clues_available", "clues_shown"}
    for key in sorted(legacy):
        old, new = legacy[key], enriched[key]
        if old["config"]["play_mode"] == "expert" and old != new:
            raise ValueError(f"expert session {key} must not change")
        for field in ("config", "dataset_version", "schema_version", "session_id"):
            if old[field] != new[field]:
                raise ValueError(f"enriched session {key} changes {field}")
        if [q["id"] for q in old["questions"]] != [q["id"] for q in new["questions"]]:
            raise ValueError(f"enriched session {key} changes the questions")
        for before, after in zip(old["questions"], new["questions"]):
            if {k: v for k, v in before.items() if k not in clue_fields} != {
                k: v for k, v in after.items() if k not in clue_fields
            }:
                raise ValueError(f"enriched session {key} changes more than clues")
            if before["clues_available"] and (
                before["clues_available"] != after["clues_available"]
                or before["clues_shown"] != after["clues_shown"]
            ):
                raise ValueError(f"enriched session {key} changes an existing clue")


def validate_quiz_sessions(
    sessions: dict[str, dict[str, Any]],
    enriched_sessions: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Every check ``publish`` makes on the quiz; returns the v2 and v3 manifests."""
    for session in sessions.values():
        validate_session(session)
        validate_legacy_clues(session)
    enriched_manifest = None
    if enriched_sessions is not None:
        for session in enriched_sessions.values():
            validate_session(session)
        validate_enrichment(sessions, enriched_sessions)
        enriched_manifest = build_manifest(enriched_sessions, ENRICHED_MANIFEST_VERSION)
    return build_manifest(sessions), enriched_manifest


def publish(
    output_dir: Path,
    sessions: dict[str, dict[str, Any]] | None,
    grid: dict[str, Any] | None = None,
    connections: dict[str, Any] | None = None,
    name_guess: dict[str, Any] | None = None,
    word_search: dict[str, Any] | None = None,
    timeline: dict[str, Any] | None = None,
    code_groups: dict[str, Any] | None = None,
    enriched_sessions: dict[str, dict[str, Any]] | None = None,
    crossword: dict[str, Any] | None = None,
) -> None:
    """Publish static quiz sessions, optional daily grid, connections, name-guess, word-search, timeline, and group code puzzles.

    Args:
        output_dir: Target directory where artifacts and manifest are written.
        sessions: Validated locale and difficulty quiz sessions mapping. The
            v2 manifest lists them, so none may carry a clue outside its own
            question's facts (see ``validate_legacy_clues``). None omits the
            quiz: no session and no manifest is written. The daily runner
            does this when the quiz could not be generated for the day.
        enriched_sessions: Optional copy of ``sessions`` whose questions may
            carry related decade clues (see ``validate_enrichment``). Written
            with ``manifest-v3.json``; when None, no v3 manifest is written.
        grid: Optional intersection grid payload (written to grid.daily.json).
            When provided, validated against intersection grid schema before writing.
            When None, grid artifact is omitted.
        connections: Optional connections puzzle payload (written to connections.daily.json).
            When provided, validated against connections puzzle schema before writing.
            When None, connections artifact is omitted.
        name_guess: Optional name guess puzzle payload (written to name-guess.daily.json).
            When provided, validated against name guess puzzle schema before writing.
            When None, name_guess artifact is omitted.
        word_search: Optional word search puzzle payload (written to word-search.daily.json).
            When provided, validated against word search puzzle schema before writing.
            When None, word_search artifact is omitted.
        timeline: Optional timeline puzzle payload (written to timeline.daily.json).
            When provided, validated against timeline puzzle schema before writing.
            When None, timeline artifact is omitted.
        code_groups: Optional group code pilot payload (written to code-groups.daily.json).
            When provided, validated against the code groups contract before writing.
            When None, code_groups artifact is omitted; the daily runner treats
            this as a partial publish and lets the other games of the day out.
        crossword: Optional ``crossword-daily-v1`` artifact, ready or omitted
            (written to crossword.daily.json). The caller validates it against
            the fact base and writes its publication record; here it passes the
            rules that need no base. When None, the artifact is omitted.
    """
    if sessions is None and enriched_sessions is not None:
        raise ValueError("enriched sessions need the sessions they enrich")
    manifest = enriched_manifest = None
    if sessions is not None:
        manifest, enriched_manifest = validate_quiz_sessions(sessions, enriched_sessions)
    if grid is not None:
        validate_intersection_grid(grid)
    if connections is not None:
        validate_connections_puzzle(connections)
    if name_guess is not None:
        validate_name_guess_puzzle(name_guess)
    if word_search is not None:
        validate_word_search_puzzle(word_search)
    if timeline is not None:
        validate_timeline_puzzle(timeline)
    if code_groups is not None:
        validate_code_groups_puzzle(code_groups)
    if crossword is not None:
        validate_crossword_daily(crossword)
    output_dir.mkdir(parents=True, exist_ok=True)
    if grid is not None:
        write_intersection_grid_atomic(output_dir / GRID_DAILY_FILENAME, grid)
    if connections is not None:
        write_connections_puzzle_atomic(output_dir / CONNECTIONS_DAILY_FILENAME, connections)
    if name_guess is not None:
        write_name_guess_puzzle_atomic(output_dir / NAME_GUESS_DAILY_FILENAME, name_guess)
    if word_search is not None:
        write_word_search_puzzle_atomic(output_dir / WORD_SEARCH_DAILY_FILENAME, word_search)
    if timeline is not None:
        write_timeline_puzzle_atomic(output_dir / TIMELINE_DAILY_FILENAME, timeline)
    if code_groups is not None:
        # write_json_atomic validates again and writes canonical bytes, the
        # same discipline the other daily artifacts get from their writers.
        write_json_atomic(
            output_dir / CODE_GROUPS_DAILY_FILENAME, code_groups, validate_code_groups_puzzle
        )
    if crossword is not None:
        write_json_atomic(output_dir / CROSSWORD_DAILY_FILENAME, crossword, validate_crossword_daily)
    if sessions is None or manifest is None:
        return
    for key in sorted(sessions):
        filename = manifest["sessions"][key]["path"]
        write_json_atomic(output_dir / filename, sessions[key], validate_session)
    if enriched_sessions is not None and enriched_manifest is not None:
        for key in sorted(enriched_sessions):
            filename = enriched_manifest["sessions"][key]["path"]
            write_json_atomic(output_dir / filename, enriched_sessions[key], validate_session)
        # The v2 manifest goes last of the two: a reader that finds either
        # one finds every session it names.
        write_json_atomic(
            output_dir / ENRICHED_MANIFEST_FILENAME,
            enriched_manifest,
            lambda payload: validate_manifest(payload, ENRICHED_MANIFEST_VERSION),
        )
    write_json_atomic(output_dir / MANIFEST_FILENAME, manifest, validate_manifest)


def verify(
    output_dir: Path,
    require_grid: bool = False,
    require_connections: bool = False,
    require_name_guess: bool = False,
    require_word_search: bool = False,
    require_timeline: bool = False,
    require_code_groups: bool = False,
    require_catalog: bool = False,
    require_crossword: bool = False,
) -> None:
    """Verify published static quiz artifacts, manifest, grid file, connections, name-guess, word-search, timeline, and group code.

    A set the daily runner wrote carries ``daily-set.json`` (see
    ``daily_set``), which lists the games the day omits and why. A game it
    lists must have no file, and a required file may be absent only when its
    game is listed; without the quiz the day has no manifest-v2.json. Every
    present artifact except the grid, which may be kept from an earlier day,
    must be for the record's date. A set without the record keeps the rules
    of each flag below and must carry manifest-v2.json.

    Args:
        output_dir: Directory containing manifest-v2.json and artifact files.
        require_grid: Verification policy flag for grid artifact (grid.daily.json).
            When False (default): backwards-compatible policy. If grid.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: grid.daily.json is mandatory and must exist and satisfy
            schema validation, raising ValueError if missing or invalid. The one
            exception is a day the runner published without a grid: its
            ``grid-publication.<date>.json`` (dated by daily-set.json, or by
            connections.daily.json in a set older than that record) has
            ``grid_id`` null, and the missing file passes.
        require_connections: Verification policy flag for connections puzzle (connections.daily.json).
            When False (default): backwards-compatible policy. If connections.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: connections.daily.json is mandatory and must exist and
            satisfy schema validation, raising ValueError if missing or invalid.
        require_name_guess: Verification policy flag for name-guess puzzle (name-guess.daily.json).
            When False (default): backwards-compatible policy. If name-guess.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: name-guess.daily.json is mandatory and must exist and
            satisfy schema validation, raising ValueError if missing or invalid.
        require_word_search: Verification policy flag for word-search puzzle (word-search.daily.json).
            When False (default): backwards-compatible policy. If word-search.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: word-search.daily.json is mandatory and must exist and
            satisfy schema validation, raising ValueError if missing or invalid.
        require_timeline: Verification policy flag for timeline puzzle (timeline.daily.json).
            When False (default): backwards-compatible policy. If timeline.daily.json
            exists on disk, it is schema-validated; if absent, verification passes.
            When True: timeline.daily.json is mandatory and must exist and
            satisfy schema validation, raising ValueError if missing or invalid.
        require_code_groups: Verification policy flag for the group code pilot
            (code-groups.daily.json).
            When False (default): backwards-compatible policy. If
            code-groups.daily.json exists on disk, it is validated against the
            code groups contract; if absent, verification passes. This keeps
            sets published before the daily integration, and days published
            under the partial publish policy (generation failure), verifiable.
            When True: code-groups.daily.json is mandatory and must exist and
            satisfy contract validation, raising ValueError if missing or invalid.
        require_catalog: Verification policy flag for the question catalog
            (catalog-manifest-v1.json and its shards).
            When False (default): the catalog is optional, as it is published
            only when the daily run asks for it; one that is present must verify
            completely (hashes, schema, identity, language, version).
            When True: the catalog is mandatory.
        require_crossword: Verification policy flag for the daily crossword
            (crossword.daily.json). When False (default) the artifact is
            optional: a day whose generation failed publishes without it. A
            present file must pass every rule that needs no fact base and agree
            with its ``crossword-publication.<date>.json`` record. When True the
            file is mandatory. Every record in the directory is validated, and
            two consecutive played days may not share a group.
    """
    day_set = read_daily_set(output_dir)
    omitted = day_set["omitted"] if day_set is not None else {}
    _verify_omitted_games_absent(output_dir, omitted)
    sessions: dict[str, dict[str, Any]] = {}
    if "quiz" in omitted:
        verify_question_catalog(output_dir, None, None, require_catalog)
    else:
        sessions = _verify_quiz(output_dir, require_catalog)
    readers = {
        "connections": _read_connections,
        "grid": _read_grid,
        "name-guess": _read_name_guess,
        "word-search": _read_word_search,
        "timeline": _read_timeline,
        "code-groups": _read_code_groups,
        "crossword": _read_crossword,
    }
    payloads = {}
    for game, reader in readers.items():
        path = output_dir / DAILY_GAME_FILES[game]
        if path.is_file():
            with _located(path):
                payloads[game] = reader(path)
    # A set the runner wrote names its date; an older one is dated by its
    # connections board, which every such set carries.
    if day_set is not None:
        day = day_set["reference_date"]
    else:
        day = payloads["connections"]["reference_date"] if "connections" in payloads else None
    grid_publication = None
    if day is not None:
        from .grid_publication import read_publication
        grid_publication = read_publication(output_dir, day)
    required = {
        "connections": require_connections,
        "grid": require_grid,
        "name-guess": require_name_guess,
        "word-search": require_word_search,
        "timeline": require_timeline,
        "code-groups": require_code_groups,
        "crossword": require_crossword,
    }
    for game, needed in required.items():
        if not needed or game in payloads or game in omitted:
            continue
        # The daily runner may publish a day without a grid (grid_skipped);
        # its publication record then says so with grid_id null.
        if game == "grid" and grid_publication is not None and grid_publication["grid_id"] is None:
            continue
        raise ValueError(f"missing required {game} artifact: {output_dir / DAILY_GAME_FILES[game]}")
    shortcuts = {
        name: _read_session(output_dir / name)
        for name in SESSION_SHORTCUT_FILENAMES
        if (output_dir / name).is_file()
    }
    if day_set is not None:
        _verify_dates(output_dir, day, payloads, sessions, shortcuts)
    verify_crossword_history(output_dir)


def _verify_dates(
    output_dir: Path,
    day: str,
    payloads: dict[str, dict[str, Any]],
    sessions: dict[str, dict[str, Any]],
    shortcuts: dict[str, dict[str, Any]],
) -> None:
    """Every artifact of a recorded set is for the record's date.

    A board carries ``reference_date``; the grid is left out, because it may
    be an earlier day's, kept when generation failed. A daily quiz session
    carries its date in the seed, and so do ``session.<locale>.json``. The
    base and decade sessions have no date.
    """
    dated = [
        (str(output_dir / DAILY_GAME_FILES[game]), payload["reference_date"])
        for game, payload in payloads.items()
        if game != "grid"
    ]
    dated += [
        (f"{output_dir}: quiz session {key}", _daily_session_date(session))
        for key, session in sessions.items()
        if key.startswith("daily.")
    ]
    dated += [(str(output_dir / name), _daily_session_date(session)) for name, session in shortcuts.items()]
    for where, value in dated:
        if value != day:
            raise ValueError(f"{where} is for {value}, but {DAILY_SET_FILENAME} publishes {day}")


def _daily_session_date(session: dict[str, Any]) -> str | None:
    seed = session["config"]["seed"]
    return seed.removeprefix(DAILY_SEED_PREFIX) if seed.startswith(DAILY_SEED_PREFIX) else None


def _verify_omitted_games_absent(output_dir: Path, omitted: dict[str, str]) -> None:
    """A game the daily set lists as omitted must have no file in the set."""
    for game in omitted:
        names = [DAILY_GAME_FILES[game]]
        if game == "quiz":
            names += [ENRICHED_MANIFEST_FILENAME, *SESSION_SHORTCUT_FILENAMES]
        for name in names:
            if (output_dir / name).exists():
                raise ValueError(
                    f"{output_dir / name} is published, but {DAILY_SET_FILENAME} omits {game}"
                )


def _verify_quiz(output_dir: Path, require_catalog: bool) -> dict[str, dict[str, Any]]:
    """Verify the v2 manifest, its sessions, the v3 manifest and the catalog.

    Returns the sessions the v2 manifest names, by key.
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
    for session in sessions.values():
        validate_legacy_clues(session)
    verify_enriched_manifest(output_dir, sessions)
    verify_question_catalog(output_dir, manifest, sessions, require_catalog)
    return sessions


def _holds_a_set(directory: Path) -> bool:
    """Whether ``directory`` holds a published set; a set may omit the quiz."""
    return (directory / MANIFEST_FILENAME).is_file() or (directory / DAILY_SET_FILENAME).is_file()


def verify_enriched_manifest(output_dir: Path, legacy: dict[str, dict[str, Any]]) -> None:
    """Verify manifest-v3.json, when present, against the legacy sessions."""
    path = output_dir / ENRICHED_MANIFEST_FILENAME
    if not path.is_file():
        return
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read enriched web manifest: {exc}") from exc
    validate_manifest(manifest, ENRICHED_MANIFEST_VERSION)
    sessions = {
        key: _read_session(output_dir / manifest["sessions"][key]["path"])
        for key in sorted(manifest["sessions"])
    }
    if manifest != build_manifest(sessions, ENRICHED_MANIFEST_VERSION):
        raise ValueError("web artifacts do not match enriched manifest")
    validate_enrichment(legacy, sessions)


def verify_question_catalog(
    output_dir: Path,
    manifest: dict[str, Any] | None,
    sessions: dict[str, dict[str, Any]] | None,
    required: bool = False,
) -> None:
    """Verify the question catalog, when present, and its agreement with the sessions.

    The catalog is refreshed on every run while a day's sessions may be kept or
    promoted from ``next/``, so the two can come from different datasets. Only
    when they share one does every session question have to be an eligible
    question of the catalog. A day that omits the quiz has no manifest, and
    the catalog is then verified on its own.
    """
    if not (output_dir / CATALOG_MANIFEST_FILENAME).is_file():
        if required:
            raise ValueError(f"missing required catalog manifest: {output_dir / CATALOG_MANIFEST_FILENAME}")
        return
    catalog_manifest, shards = read_catalog(output_dir)
    if (
        manifest is not None
        and sessions is not None
        and catalog_manifest["dataset_version"] == manifest["dataset_version"]
    ):
        validate_sessions_in_catalog(sessions, shards)


def verify_artifacts(
    output_dir: Path,
    require_grid: bool = True,
    require_connections: bool = True,
    require_name_guess: bool = True,
    require_word_search: bool = True,
    require_timeline: bool = True,
    require_code_groups: bool = True,
    require_catalog: bool = False,
    require_crossword: bool = False,
) -> None:
    """Verify published static quiz artifacts and daily puzzle files.

    ``require_code_groups`` defaults to True like the other complete daily
    artifacts, so a caller that accepts the partial publish policy for the
    group code pilot must pass False explicitly (the daily runner does).
    """
    verify(
        output_dir,
        require_grid=require_grid,
        require_connections=require_connections,
        require_name_guess=require_name_guess,
        require_word_search=require_word_search,
        require_timeline=require_timeline,
        require_code_groups=require_code_groups,
        require_catalog=require_catalog,
        require_crossword=require_crossword,
    )


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
    parser.add_argument(
        "--require-word-search",
        action="store_true",
        help="Require word-search.daily.json to exist and pass schema validation during --verify",
    )
    parser.add_argument(
        "--require-timeline",
        action="store_true",
        help="Require timeline.daily.json to exist and pass schema validation during --verify",
    )
    parser.add_argument(
        "--require-code-groups",
        action="store_true",
        help="Require code-groups.daily.json to exist and pass contract validation during --verify",
    )
    parser.add_argument(
        "--require-crossword",
        action="store_true",
        help="Require crossword.daily.json to exist and agree with its publication record during --verify",
    )
    parser.add_argument(
        "--require-catalog",
        action="store_true",
        help="Require the question catalog to exist and verify completely during --verify",
    )
    parser.add_argument(
        "--catalog",
        action="store_true",
        help=(
            "Also publish the static question catalog (catalog-manifest-v1.json and "
            "its shards) built from the same dataset as the sessions"
        ),
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
        if args.require_word_search and not args.verify:
            raise ValueError("--require-word-search can only be used with --verify")
        if args.require_timeline and not args.verify:
            raise ValueError("--require-timeline can only be used with --verify")
        if args.require_code_groups and not args.verify:
            raise ValueError("--require-code-groups can only be used with --verify")
        if args.require_crossword and not args.verify:
            raise ValueError("--require-crossword can only be used with --verify")
        if args.require_catalog and not args.verify:
            raise ValueError("--require-catalog can only be used with --verify")
        if args.catalog and args.verify:
            raise ValueError("--catalog publishes; it cannot be used with --verify")
        if args.verify:
            # next/ holds the following day's set when the daily run publishes ahead.
            next_dir = args.output_dir / "next"
            for directory in (args.output_dir, next_dir):
                if directory is next_dir and not _holds_a_set(next_dir):
                    continue
                with _located(directory):
                    verify(
                        directory,
                        require_grid=args.require_grid,
                        require_connections=args.require_connections,
                        require_name_guess=args.require_name_guess,
                        require_word_search=args.require_word_search,
                        require_timeline=args.require_timeline,
                        require_code_groups=args.require_code_groups,
                        require_catalog=args.require_catalog and directory is args.output_dir,
                        require_crossword=args.require_crossword,
                    )
            # The next day's record follows the main directory's last one.
            verify_crossword_history(args.output_dir, next_dir)
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
            decade_sessions = create_decade_sessions(dataset, args.seed, args.timer_seconds)
            sessions = {**base_sessions, **daily_sessions, **decade_sessions}
            publish(args.output_dir, sessions)
            if args.catalog:
                publish_catalog(args.output_dir, build_catalog(dataset))
        else:
            raise ValueError("provide --database or --verify")
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(f"Web publication failed: {exc}")
        return 1
    print(f"Web artifacts {'verified' if args.verify else 'published'} in {args.output_dir}")
    day_set = read_daily_set(args.output_dir)
    for game, reason in (day_set["omitted"] if day_set is not None else {}).items():
        print(f"Daily set for {day_set['reference_date']} omits {game}: {reason}")
    # A day that omits the quiz has no manifest to report on.
    if (args.output_dir / MANIFEST_FILENAME).is_file():
        for line in published_clue_coverage_lines(args.output_dir, "Quiz clues"):
            print(line)
    if (args.output_dir / CATALOG_MANIFEST_FILENAME).is_file():
        for line in published_catalog_coverage_lines(args.output_dir, "Quiz catalog"):
            print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
