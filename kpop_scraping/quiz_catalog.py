"""Static catalog of the quiz questions each language, play mode and filter can draw from.

The catalog is built from the validated quiz dataset and published beside the
sessions: one shard per language and play mode, plus a manifest that names the
shards by hash. Nothing is collected or generated when it is read. A shard
carries every question with its evidence, and ``pools`` lists, for the
unfiltered game and for each decade, which of those questions the matching
session may draw from. It uses the eligibility rule of ``create_session``.

Clients released before the catalog never request it, and no session or session
manifest changes shape, so the catalog adds nothing a released client can reject.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .quiz_models import QuizConfig
from .quiz_schema import (
    QUESTION_TYPES,
    _require,
    _require_date,
    _require_hash,
    validate_dataset,
    validate_question,
    write_json_atomic,
)
from .quiz_session import eligible_questions
from .storage import canonical_json

CATALOG_SCHEMA_VERSION = "kpop-quiz-catalog-v1"
CATALOG_MANIFEST_VERSION = "kpop-quiz-catalog-manifest-v1"
CATALOG_MANIFEST_FILENAME = "catalog-manifest-v1.json"
CATALOG_LOCALES = ("pt-BR", "en")
CATALOG_MODES = ("assisted", "standard", "expert")
CATALOG_DECADES = (1990, 2000, 2010, 2020)
POOL_KEYS = ("all", *(f"decade.{decade}" for decade in CATALOG_DECADES))
SHARD_KEYS = tuple(f"{locale}.{mode}" for locale in CATALOG_LOCALES for mode in CATALOG_MODES)
SESSION_SIZE = 10
# Questions differ between the legacy sessions and an enriched catalog only here.
CLUE_FIELDS = frozenset({"clues_available", "clues_shown"})

SHARD_FIELDS = frozenset(
    {
        "dataset_version", "generator_version", "language", "play_mode", "pools",
        "questions", "reference_date", "schema_version", "source_policy_version",
        "template_version",
    }
)
MANIFEST_FIELDS = frozenset(
    {"catalog_version", "dataset_version", "reference_date", "schema_version", "shards"}
)


def shard_path(key: str, digest: str) -> str:
    return f"catalog.{key}.{digest}.json"


def replay_status(eligible: int) -> str:
    """How a pool serves a new round of ten questions.

    ``ok`` leaves room for a selection other than the previous one,
    ``repeats`` has exactly ten questions so every round is the same set, and
    ``unavailable`` cannot fill a round without duplicates or another filter.
    """
    if eligible > SESSION_SIZE:
        return "ok"
    return "repeats" if eligible == SESSION_SIZE else "unavailable"


def shard_bytes(shard: dict[str, Any]) -> bytes:
    return canonical_json(shard) + b"\n"


def shard_digest(shard: dict[str, Any]) -> str:
    return hashlib.sha256(shard_bytes(shard)).hexdigest()


def catalog_version(dataset_version: str, digests: dict[str, str]) -> str:
    """Content version of a catalog: the dataset and the hash of every shard.

    Plain lines, so a client recomputes it without a canonical JSON writer.
    """
    lines = [CATALOG_MANIFEST_VERSION, dataset_version]
    lines += [f"{key}:{digests[key]}" for key in sorted(digests)]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def build_catalog(dataset: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Build and validate one shard per language and play mode of ``dataset``."""
    validate_dataset(dataset)
    languages = set(dataset["languages"])
    if languages != set(CATALOG_LOCALES):
        raise ValueError("a catalog needs the pt-BR and en questions of one dataset")
    shards: dict[str, dict[str, Any]] = {}
    for locale in CATALOG_LOCALES:
        for mode in CATALOG_MODES:
            pools_by_key: dict[str, list[dict[str, Any]]] = {}
            for pool_key in POOL_KEYS:
                decade = None if pool_key == "all" else int(pool_key.split(".", 1)[1])
                pools_by_key[pool_key] = eligible_questions(
                    dataset, QuizConfig(locale, "catalog", play_mode=mode, decade=decade)
                )
            members = {
                question["id"]: question
                for pool in pools_by_key.values()
                for question in pool
            }
            questions = sorted(members.values(), key=lambda question: question["logical_id"])
            index_by_id = {question["id"]: index for index, question in enumerate(questions)}
            shard = {
                "dataset_version": dataset["dataset_version"],
                "generator_version": dataset["generator_version"],
                "language": locale,
                "play_mode": mode,
                "pools": {
                    pool_key: sorted(index_by_id[question["id"]] for question in pool)
                    for pool_key, pool in pools_by_key.items()
                },
                "questions": questions,
                "reference_date": dataset["reference_date"],
                "schema_version": CATALOG_SCHEMA_VERSION,
                "source_policy_version": dataset["source_policy_version"],
                "template_version": dataset["template_version"],
            }
            validate_catalog_shard(shard)
            shards[f"{locale}.{mode}"] = shard
    return shards


def build_catalog_manifest(shards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Describe validated shards by hash, with the eligible count of every pool."""
    if set(shards) != set(SHARD_KEYS):
        raise ValueError("a catalog needs every language and play mode")
    versions = {shard["dataset_version"] for shard in shards.values()}
    dates = {shard["reference_date"] for shard in shards.values()}
    if len(versions) != 1 or len(dates) != 1:
        raise ValueError("catalog shards must come from one dataset")
    entries: dict[str, Any] = {}
    for key in sorted(shards):
        shard = shards[key]
        validate_catalog_shard(shard)
        _require(f"{shard['language']}.{shard['play_mode']}" == key, "catalog shard key")
        digest = shard_digest(shard)
        entries[key] = {
            "path": shard_path(key, digest),
            "pools": {pool_key: len(shard["pools"][pool_key]) for pool_key in POOL_KEYS},
            "questions": len(shard["questions"]),
            "sha256": digest,
        }
    dataset_version = versions.pop()
    manifest = {
        "catalog_version": catalog_version(
            dataset_version, {key: entry["sha256"] for key, entry in entries.items()}
        ),
        "dataset_version": dataset_version,
        "reference_date": dates.pop(),
        "schema_version": CATALOG_MANIFEST_VERSION,
        "shards": entries,
    }
    validate_catalog_manifest(manifest)
    return manifest


def validate_catalog_shard(payload: Any) -> None:
    """Check one shard on its own: schema, identity, language, mode and pools."""
    _require(isinstance(payload, dict), "catalog shard")
    _require(payload.get("schema_version") == CATALOG_SCHEMA_VERSION, "catalog schema_version")
    _require(set(payload) == SHARD_FIELDS, "catalog shard fields")
    _require_hash(payload.get("dataset_version"), "catalog dataset_version")
    _require_date(payload.get("reference_date"), "catalog reference_date")
    for field in ("generator_version", "template_version", "source_policy_version"):
        _require(isinstance(payload.get(field), str) and bool(payload[field]), f"catalog {field}")
    language, mode = payload.get("language"), payload.get("play_mode")
    _require(language in CATALOG_LOCALES, "catalog language")
    _require(mode in CATALOG_MODES, "catalog play_mode")
    questions = payload.get("questions")
    _require(isinstance(questions, list) and bool(questions), "catalog questions")
    ids: set[str] = set()
    semantic_ids: set[str] = set()
    previous_logical_id = ""
    for question in questions:
        validate_question(question)
        _require(question["language"] == language, "catalog question language")
        _require(question["play_mode"] == mode, "catalog question play mode")
        _require(question["reference_date"] == payload["reference_date"], "catalog question reference_date")
        _require(question["type"] in QUESTION_TYPES, "catalog question type")
        _require(question["id"] not in ids, "duplicate catalog question id")
        _require(question["semantic_id"] not in semantic_ids, "duplicate catalog semantic id")
        _require(question["logical_id"] > previous_logical_id, "catalog question order")
        ids.add(question["id"])
        semantic_ids.add(question["semantic_id"])
        previous_logical_id = question["logical_id"]
    pools = payload.get("pools")
    _require(isinstance(pools, dict) and set(pools) == set(POOL_KEYS), "catalog pools")
    referenced: set[int] = set()
    for pool_key, indexes in pools.items():
        _require(
            isinstance(indexes, list)
            and all(type(index) is int and 0 <= index < len(questions) for index in indexes)
            and all(left < right for left, right in zip(indexes, indexes[1:])),
            f"catalog pool {pool_key}",
        )
        if pool_key != "all":
            decade = int(pool_key.split(".", 1)[1])
            _require(
                all(decade in questions[index].get("decades", []) for index in indexes),
                f"catalog pool {pool_key} decade",
            )
        referenced.update(indexes)
    _require(bool(pools["all"]), "catalog pool all is empty")
    _require(len(referenced) == len(questions), "catalog question outside every pool")


def validate_catalog_manifest(payload: Any) -> None:
    _require(isinstance(payload, dict), "catalog manifest")
    _require(payload.get("schema_version") == CATALOG_MANIFEST_VERSION, "catalog manifest schema_version")
    _require(set(payload) == MANIFEST_FIELDS, "catalog manifest fields")
    _require_hash(payload.get("dataset_version"), "catalog manifest dataset_version")
    _require_hash(payload.get("catalog_version"), "catalog manifest catalog_version")
    _require_date(payload.get("reference_date"), "catalog manifest reference_date")
    shards = payload.get("shards")
    _require(isinstance(shards, dict) and set(shards) == set(SHARD_KEYS), "catalog manifest shards")
    for key, entry in shards.items():
        _require(
            isinstance(entry, dict) and set(entry) == {"path", "pools", "questions", "sha256"},
            f"catalog manifest shard {key}",
        )
        _require_hash(entry["sha256"], f"catalog manifest sha256 {key}")
        _require(entry["path"] == shard_path(key, entry["sha256"]), f"catalog manifest path {key}")
        _require(type(entry["questions"]) is int and entry["questions"] > 0, f"catalog manifest questions {key}")
        pools = entry["pools"]
        _require(
            isinstance(pools, dict)
            and set(pools) == set(POOL_KEYS)
            and all(type(count) is int and 0 <= count <= entry["questions"] for count in pools.values())
            and pools["all"] > 0,
            f"catalog manifest pools {key}",
        )
    _require(
        payload["catalog_version"]
        == catalog_version(
            payload["dataset_version"], {key: entry["sha256"] for key, entry in shards.items()}
        ),
        "catalog manifest catalog_version",
    )


def publish_catalog(output_dir: Path, shards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Write the shards, then the manifest, then drop the files they replace.

    The manifest goes last, as the marker of a complete catalog, and the
    previous generation stays until it is installed: a reader that holds the
    old manifest finds its shards until this call finishes, and a call that
    fails earlier leaves the old catalog intact.
    """
    manifest = build_catalog_manifest(shards)
    output_dir.mkdir(parents=True, exist_ok=True)
    for key in sorted(shards):
        write_json_atomic(output_dir / manifest["shards"][key]["path"], shards[key], validate_catalog_shard)
    write_json_atomic(output_dir / CATALOG_MANIFEST_FILENAME, manifest, validate_catalog_manifest)
    prune_catalog(output_dir, manifest)
    return manifest


def prune_catalog(output_dir: Path, manifest: dict[str, Any] | None) -> None:
    """Remove catalog shards no manifest names; with no manifest, remove them all."""
    keep = {entry["path"] for entry in manifest["shards"].values()} if manifest else set()
    for path in output_dir.glob("catalog.*.json"):
        if path.name not in keep:
            path.unlink()


def remove_catalog(output_dir: Path) -> bool:
    """Withdraw the catalog (manifest first, so no reader sees a half-removed one)."""
    manifest = output_dir / CATALOG_MANIFEST_FILENAME
    present = manifest.is_file()
    manifest.unlink(missing_ok=True)
    prune_catalog(output_dir, None)
    return present


def read_catalog(output_dir: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Read the published catalog, checking every layer before returning anything."""
    path = output_dir / CATALOG_MANIFEST_FILENAME
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read catalog manifest: {exc}") from exc
    validate_catalog_manifest(manifest)
    shards: dict[str, dict[str, Any]] = {}
    for key in sorted(manifest["shards"]):
        entry = manifest["shards"][key]
        try:
            content = (output_dir / entry["path"]).read_bytes()
        except OSError as exc:
            raise ValueError(f"cannot read catalog shard {key}: {exc}") from exc
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError(f"catalog shard {key} does not match its manifest hash")
        try:
            shard = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot parse catalog shard {key}: {exc}") from exc
        validate_catalog_shard(shard)
        shards[key] = shard
    if manifest != build_catalog_manifest(shards):
        raise ValueError("catalog shards do not match the catalog manifest")
    return manifest, shards


def _comparable(question: dict[str, Any]) -> dict[str, Any]:
    """A question without what legitimately differs between a session and the catalog.

    A session shuffles the options with its own seed and may omit the clues an
    enriched catalog carries; the catalog keeps the dataset order of the options.
    """
    plain = {name: value for name, value in question.items() if name not in CLUE_FIELDS}
    plain["options"] = sorted(question["options"], key=lambda option: option["id"])
    return plain


def validate_sessions_in_catalog(
    sessions: dict[str, dict[str, Any]], shards: dict[str, dict[str, Any]]
) -> None:
    """Require every session question to be an eligible question of its catalog pool.

    Holds when sessions and catalog come from one dataset: the session draws
    from the pool the catalog publishes. The catalog may carry clues the
    legacy session does not (an enriched catalog), and keeps the options in
    dataset order instead of the order of the session seed. Nothing else differs.
    """
    for key in sorted(sessions):
        session = sessions[key]
        config = session["config"]
        shard = shards[f"{config['language']}.{config['play_mode']}"]
        pool_key = "all" if config.get("decade") is None else f"decade.{config['decade']}"
        pool = {shard["questions"][index]["id"]: shard["questions"][index] for index in shard["pools"][pool_key]}
        for question in session["questions"]:
            published = pool.get(question["id"])
            _require(published is not None, f"session {key} question outside the catalog pool")
            _require(
                _comparable(question) == _comparable(published),
                f"session {key} question differs from the catalog",
            )
            if question["clues_available"]:
                _require(
                    question["clues_available"] == published["clues_available"]
                    and question["clues_shown"] == published["clues_shown"],
                    f"session {key} clue differs from the catalog",
                )


def verify_catalog(output_dir: Path, required: bool = False) -> bool:
    """Verify the catalog in ``output_dir``; return whether one is published.

    Without ``required``, a directory with no catalog manifest verifies (the
    catalog is optional); a manifest that is present must verify completely.
    """
    if not (output_dir / CATALOG_MANIFEST_FILENAME).is_file():
        if required:
            raise ValueError(f"missing required catalog manifest: {output_dir / CATALOG_MANIFEST_FILENAME}")
        return False
    read_catalog(output_dir)
    return True


def catalog_coverage(shards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Count what each shard offers: eligible questions per pool, types and clues."""
    coverage: dict[str, Any] = {}
    for key in sorted(shards):
        shard = shards[key]
        questions = shard["questions"]
        by_type: dict[str, int] = {}
        for question in questions:
            by_type[question["type"]] = by_type.get(question["type"], 0) + 1
        coverage[key] = {
            "questions": len(questions),
            "pools": {
                pool_key: {
                    "eligible": len(shard["pools"][pool_key]),
                    "replay": replay_status(len(shard["pools"][pool_key])),
                }
                for pool_key in POOL_KEYS
            },
            "by_type": dict(sorted(by_type.items())),
            "distinct_fact_bases": len({fact for question in questions for fact in question["fact_base_ids"]}),
            "with_clue": sum(bool(question["clues_available"]) for question in questions),
        }
    return coverage


def catalog_coverage_lines(manifest: dict[str, Any], shards: dict[str, dict[str, Any]], label: str) -> list[str]:
    """Report the published catalog the way the clue coverage is reported."""
    coverage = catalog_coverage(shards)
    lines = [
        f"{label} [catalog {manifest['catalog_version'][:12]}, dataset {manifest['dataset_version'][:12]}, "
        f"reference date {manifest['reference_date']}]: {len(shards)} shards, "
        f"{sum(item['questions'] for item in coverage.values())} question variants"
    ]
    for key in sorted(coverage):
        item = coverage[key]
        pools = ", ".join(
            f"{pool_key} {pool['eligible']} ({pool['replay']})" for pool_key, pool in item["pools"].items()
        )
        lines.append(f"{label} {key}: {pools}")
        if key.endswith(".standard"):
            lines.append(
                f"{label} {key}: {item['distinct_fact_bases']} distinct fact bases, "
                f"{item['with_clue']}/{item['questions']} questions with a clue"
            )
    return lines


def published_catalog_coverage_lines(directory: Path, label: str) -> list[str]:
    """Verified coverage lines of the catalog in ``directory``; empty when none is published."""
    if not (directory / CATALOG_MANIFEST_FILENAME).is_file():
        return [f"{label}: not published"]
    manifest, shards = read_catalog(directory)
    return catalog_coverage_lines(manifest, shards, label)
