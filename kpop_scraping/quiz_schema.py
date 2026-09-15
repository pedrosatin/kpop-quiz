"""Schema checks and atomic JSON writes for published quiz artifacts."""

from __future__ import annotations

import os
import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .storage import canonical_json


DATASET_SCHEMA_VERSION = "kpop-quiz-dataset-v2"
SESSION_SCHEMA_VERSION = "kpop-quiz-session-v2"
REPORT_SCHEMA_VERSION = "kpop-quiz-generation-report-v3"
QUESTION_TYPES = frozenset(
    {
        "formation_year",
        "member_at_date",
        "birth_date_or_place",
        "age_on_date",
        "group_for_member",
        "member_for_group",
        "group_for_record_label",
        "record_label_for_group",
        "chronological_comparison",
        "release_for_group",
        "group_for_release",
        "release_year",
        "earliest_release",
    }
)
DATASET_FIELDS = frozenset(
    {
        "dataset_version", "generator_version", "language_variant_count",
        "languages", "logical_question_count", "questions", "reference_date",
        "schema_version", "source_policy_version", "template_version",
    }
)
QUESTION_FIELDS = frozenset(
    {
        "answer_option_id", "base_logical_id", "base_points", "challenge_rating", "clues_available",
        "clues_shown", "play_mode", "evidence", "explanation", "hint_cost",
        "fact_base_ids", "group_ids", "id", "language", "logical_id",
        "options", "prompt", "reference_date", "semantic_id", "theme", "type",
    }
)


def validate_dataset(payload: dict[str, Any]) -> None:
    _require(isinstance(payload, dict), "dataset")
    _require(payload.get("schema_version") == DATASET_SCHEMA_VERSION, "schema_version")
    _require(set(payload) == DATASET_FIELDS, "dataset fields")
    _require_hash(payload.get("dataset_version"), "dataset_version")
    reference_date = payload.get("reference_date")
    _require_date(reference_date, "reference_date")
    for field in ("generator_version", "template_version", "source_policy_version"):
        _require(isinstance(payload.get(field), str) and payload[field], field)
    languages = payload.get("languages")
    _require(
        isinstance(languages, list)
        and languages
        and len(languages) == len(set(languages))
        and set(languages) <= {"pt-BR", "en"},
        "languages",
    )
    questions = payload.get("questions")
    _require(isinstance(questions, list), "questions")
    ids: set[str] = set()
    logical_languages: set[tuple[str, str, str]] = set()
    languages_by_logical_id: dict[str, set[str]] = defaultdict(set)
    modes_by_logical_language: dict[tuple[str, str], set[str]] = defaultdict(set)
    semantic_languages: set[tuple[str, str, str]] = set()
    for question in questions:
        _validate_question(question)
        _require(question["reference_date"] == reference_date, "question reference_date")
        _require(question["language"] in languages, "question language")
        _require(question["id"] not in ids, "duplicate question id")
        ids.add(question["id"])
        key = (question["logical_id"], question["language"], question["play_mode"])
        _require(key not in logical_languages, "duplicate logical question mode and language")
        logical_languages.add(key)
        languages_by_logical_id[question["logical_id"]].add(question["language"])
        modes_by_logical_language[
            (question["logical_id"], question["language"])
        ].add(question["play_mode"])
        semantic_key = (
            question["semantic_id"], question["language"], question["play_mode"]
        )
        _require(semantic_key not in semantic_languages, "duplicate semantic question language")
        semantic_languages.add(semantic_key)
    _require(
        payload.get("logical_question_count") == len(languages_by_logical_id),
        "logical_question_count",
    )
    _require(
        all(value == set(languages) for value in languages_by_logical_id.values()),
        "logical question languages",
    )
    _require(
        all(
            modes == {"assisted", "standard", "expert"}
            for modes in modes_by_logical_language.values()
        ),
        "logical question play modes",
    )
    _require(payload.get("language_variant_count") == len(questions), "language_variant_count")


def validate_session(payload: dict[str, Any]) -> None:
    _require(isinstance(payload, dict), "session")
    _require(payload.get("schema_version") == SESSION_SCHEMA_VERSION, "schema_version")
    _require(
        set(payload) == {"schema_version", "dataset_version", "session_id", "config", "questions"},
        "session fields",
    )
    _require_hash(payload.get("dataset_version"), "dataset_version")
    _require_hash(payload.get("session_id"), "session_id")
    config = payload.get("config")
    _require(isinstance(config, dict), "config")
    _require(
        set(config)
        == {"language", "seed", "theme", "group_id", "play_mode", "timer_seconds"},
        "config fields",
    )
    _require(config.get("language") in {"pt-BR", "en"}, "config.language")
    _require(isinstance(config.get("seed"), str), "config.seed")
    _require(
        config.get("theme") is None
        or isinstance(config["theme"], str) and bool(config["theme"]),
        "config.theme",
    )
    _require(
        config.get("group_id") is None
        or isinstance(config["group_id"], str) and bool(config["group_id"]),
        "config.group_id",
    )
    _require(config.get("play_mode") in {"assisted", "standard", "expert"}, "config.play_mode")
    timer = config.get("timer_seconds")
    _require(timer is None or type(timer) is int and timer > 0, "config.timer_seconds")
    questions = payload.get("questions")
    _require(isinstance(questions, list) and len(questions) == 10, "questions")
    ids: set[str] = set()
    semantic_ids: set[str] = set()
    for question in questions:
        _validate_question(question)
        _require(question["language"] == config["language"], "question language")
        _require(config["theme"] is None or question["theme"] == config["theme"], "question theme")
        _require(
            config["group_id"] is None or config["group_id"] in question["group_ids"],
            "question group",
        )
        _require(
            question["play_mode"] == config["play_mode"],
            "question play mode",
        )
        _require(question["id"] not in ids, "duplicate session question id")
        _require(question["semantic_id"] not in semantic_ids, "duplicate session semantic id")
        ids.add(question["id"])
        semantic_ids.add(question["semantic_id"])


def validate_report(payload: dict[str, Any]) -> None:
    _require(isinstance(payload, dict), "report")
    _require(payload.get("schema_version") == REPORT_SCHEMA_VERSION, "schema_version")
    _require(
        set(payload)
        == {
            "accepted_by_predicate", "accepted_by_template", "accepted_by_type",
            "accepted_distinct_fact_bases", "accepted_logical",
            "clue_eligible_base_questions",
            "dataset_version", "language_variants", "rejected_by_reason",
            "schema_version", "variants_by_play_mode", "variants_by_language",
        },
        "report fields",
    )
    _require_hash(payload.get("dataset_version"), "dataset_version")
    _require(type(payload.get("accepted_logical")) is int and payload["accepted_logical"] >= 0, "accepted_logical")
    _require(type(payload.get("clue_eligible_base_questions")) is int and 0 <= payload["clue_eligible_base_questions"] <= payload["accepted_logical"], "clue_eligible_base_questions")
    _require(
        type(payload.get("accepted_distinct_fact_bases")) is int,
        "accepted_distinct_fact_bases",
    )
    _require(
        type(payload.get("language_variants")) is int and payload["language_variants"] >= 0,
        "language_variants",
    )
    _require(isinstance(payload.get("accepted_by_type"), dict), "accepted_by_type")
    _require(isinstance(payload.get("accepted_by_template"), dict), "accepted_by_template")
    _require(isinstance(payload.get("accepted_by_predicate"), dict), "accepted_by_predicate")
    _require(isinstance(payload.get("rejected_by_reason"), dict), "rejected_by_reason")
    _require(
        set(payload["accepted_by_type"]) == QUESTION_TYPES
        and all(
            type(value) is int and value >= 0
            for value in payload["accepted_by_type"].values()
        ),
        "accepted_by_type values",
    )
    _require(
        sum(payload["accepted_by_type"].values()) == payload["accepted_logical"],
        "accepted_by_type",
    )
    _require(
        payload["accepted_by_template"] == payload["accepted_by_type"],
        "accepted_by_template",
    )
    _require(
        all(
            isinstance(key, str) and key and type(value) is int and value >= 0
            for key, value in payload["accepted_by_predicate"].items()
        ),
        "accepted_by_predicate",
    )
    _require(
        0 <= payload["accepted_distinct_fact_bases"] <= payload["accepted_logical"],
        "accepted_distinct_fact_bases",
    )
    _require(
        all(type(value) is int and value >= 0 for value in payload["rejected_by_reason"].values()),
        "rejected_by_reason counts",
    )
    variants = payload.get("variants_by_language")
    _require(
        isinstance(variants, dict)
        and set(variants) <= {"pt-BR", "en"}
        and all(type(value) is int and value >= 0 for value in variants.values())
        and sum(variants.values()) == payload["language_variants"],
        "variants_by_language",
    )
    play_mode_variants = payload.get("variants_by_play_mode")
    _require(
        isinstance(play_mode_variants, dict)
        and set(play_mode_variants) == {"assisted", "standard", "expert"}
        and all(value == payload["accepted_logical"] for value in play_mode_variants.values()),
        "variants_by_play_mode",
    )


def write_json_atomic(path: Path, payload: dict[str, Any], validator: Any) -> bytes:
    """Validate and atomically replace a JSON file with canonical bytes."""
    validator(payload)
    content = canonical_json(payload) + b"\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return content


def _validate_question(question: Any) -> None:
    _require(isinstance(question, dict), "question")
    _require(set(question) == QUESTION_FIELDS, "question fields")
    _require_hash(question.get("id"), "question.id")
    _require_hash(question.get("logical_id"), "question.logical_id")
    _require_hash(question.get("base_logical_id"), "question.base_logical_id")
    _require_hash(question.get("semantic_id"), "question.semantic_id")
    _require(question.get("language") in {"pt-BR", "en"}, "question.language")
    _require(question.get("type") in QUESTION_TYPES, "question.type")
    _require(question.get("play_mode") in {"assisted", "standard", "expert"}, "play_mode")
    _require(question.get("challenge_rating") in {"easy", "medium", "hard"}, "challenge_rating")
    _require(type(question.get("base_points")) is int and question["base_points"] > 0, "base_points")
    _require(type(question.get("hint_cost")) is int and question["hint_cost"] >= 0, "hint_cost")
    _require(isinstance(question.get("theme"), str) and bool(question["theme"]), "theme")
    group_ids = question.get("group_ids")
    _require(
        isinstance(group_ids, list)
        and len(group_ids) == len(set(group_ids))
        and all(isinstance(group_id, str) and group_id for group_id in group_ids),
        "group_ids",
    )
    fact_base_ids = question.get("fact_base_ids")
    _require(
        isinstance(fact_base_ids, list)
        and fact_base_ids
        and len(fact_base_ids) == len(set(fact_base_ids))
        and all(isinstance(fact_id, str) and fact_id for fact_id in fact_base_ids),
        "fact_base_ids",
    )
    clues = question.get("clues_available")
    _require(isinstance(clues, list), "clues_available")
    clue_ids: set[str] = set()
    for clue in clues:
        _validate_clue(clue)
        _require(set(clue["fact_base_ids"]) <= set(fact_base_ids), "clue fact_base_ids")
        _require(clue["id"] not in clue_ids, "duplicate clue id")
        clue_ids.add(clue["id"])
    shown = question.get("clues_shown")
    _require(
        isinstance(shown, list)
        and len(shown) == len(set(shown))
        and set(shown) <= clue_ids,
        "clues_shown",
    )
    _require(
        question["play_mode"] == "assisted" or not shown,
        "only assisted clues are pre-shown",
    )
    _require(
        question["play_mode"] != "expert" or not clues,
        "expert mode has no clues",
    )
    _require(isinstance(question.get("prompt"), str) and question["prompt"], "prompt")
    options = question.get("options")
    _require(isinstance(options, list) and len(options) == 4, "options")
    _require(
        all(
            isinstance(option, dict)
            and set(option) == {"id", "label", "value", "value_type"}
            for option in options
        ),
        "option fields",
    )
    option_ids = [option.get("id") for option in options if isinstance(option, dict)]
    labels = [option.get("label") for option in options if isinstance(option, dict)]
    values = [option.get("value") for option in options if isinstance(option, dict)]
    value_types = [option.get("value_type") for option in options if isinstance(option, dict)]
    _require(len(option_ids) == 4 and len(set(option_ids)) == 4, "distinct option ids")
    _require(all(isinstance(option_id, str) for option_id in option_ids), "option ids")
    for option_id in option_ids:
        _require_hash(option_id, "option.id")
    _require(
        len(labels) == 4 and all(isinstance(label, str) and label for label in labels),
        "option labels",
    )
    _require(len(set(labels)) == 4, "distinct option labels")
    _require(
        len(values) == 4
        and all(isinstance(value, str) and value for value in values)
        and len(set(values)) == 4,
        "distinct option values",
    )
    _require(
        len(value_types) == 4
        and len(set(value_types)) == 1
        and value_types[0] in {
            "group", "person", "organization", "release", "time", "number"
        },
        "option value types",
    )
    _require(question.get("answer_option_id") in option_ids, "answer_option_id")
    _require(isinstance(question.get("explanation"), str) and question["explanation"], "explanation")
    _require_date(question.get("reference_date"), "reference_date")
    evidence = question.get("evidence")
    _require(isinstance(evidence, list) and evidence, "evidence")
    evidenced_fact_ids: set[str] = set()
    for item in evidence:
        _require(isinstance(item, dict), "evidence item")
        _require(
            set(item)
            == {
                "fact_base_id", "locator", "revision_id", "source_key", "source_url"
            },
            "evidence fields",
        )
        fact_base_id = item.get("fact_base_id")
        _require(fact_base_id in fact_base_ids, "evidence.fact_base_id")
        evidenced_fact_ids.add(fact_base_id)
        source_url = item.get("source_url")
        _require(isinstance(source_url, str), "evidence.source_url")
        parsed = urlsplit(source_url)
        _require(parsed.scheme == "https" and bool(parsed.netloc), "evidence.source_url")
        _require(isinstance(item.get("locator"), str) and item["locator"], "evidence.locator")
        _require(isinstance(item.get("source_key"), str) and item["source_key"], "evidence.source_key")
        _require(
            type(item.get("revision_id")) is int and item["revision_id"] > 0,
            "evidence.revision_id",
        )
    _require(evidenced_fact_ids == set(fact_base_ids), "fact_base evidence coverage")


def _validate_clue(clue: Any) -> None:
    _require(isinstance(clue, dict), "clue")
    _require(set(clue) == {"evidence", "fact_base_ids", "id", "text", "type"}, "clue fields")
    _require_hash(clue.get("id"), "clue.id")
    _require(clue.get("type") == "decade", "clue.type")
    _require(isinstance(clue.get("text"), str) and clue["text"], "clue.text")
    fact_ids = clue.get("fact_base_ids")
    _require(
        isinstance(fact_ids, list) and fact_ids
        and len(fact_ids) == len(set(fact_ids))
        and all(isinstance(value, str) and value for value in fact_ids),
        "clue.fact_base_ids",
    )
    evidence = clue.get("evidence")
    _require(isinstance(evidence, list) and evidence, "clue.evidence")
    covered: set[str] = set()
    for item in evidence:
        _require(isinstance(item, dict), "clue evidence item")
        _require(set(item) == {"fact_base_id", "locator", "revision_id", "source_key", "source_url"}, "clue evidence fields")
        _require(item.get("fact_base_id") in fact_ids, "clue evidence fact")
        covered.add(item["fact_base_id"])
        parsed = urlsplit(item.get("source_url", ""))
        _require(parsed.scheme == "https" and bool(parsed.netloc), "clue evidence url")
        _require(isinstance(item.get("locator"), str) and item["locator"], "clue evidence locator")
        _require(isinstance(item.get("source_key"), str) and item["source_key"], "clue evidence source")
        _require(type(item.get("revision_id")) is int and item["revision_id"] > 0, "clue evidence revision")
    _require(covered == set(fact_ids), "clue evidence coverage")


def _require(condition: bool, field: str) -> None:
    if not condition:
        raise ValueError(f"invalid quiz JSON field: {field}")


def _require_hash(value: Any, field: str) -> None:
    _require(
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value),
        field,
    )


def _require_date(value: Any, field: str) -> None:
    _require(isinstance(value, str), field)
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"invalid quiz JSON field: {field}") from exc
