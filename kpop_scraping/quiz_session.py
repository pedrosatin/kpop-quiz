"""Create deterministic ten-question sessions from a quiz dataset."""

from __future__ import annotations

from typing import Any

from .group_relevance_scoring import ASSISTED_MIN_SCORE, EXPERT_MAX_SCORE
from .quiz_models import InsufficientQuestionsError, QuizConfig
from .quiz_schema import SESSION_SCHEMA_VERSION, validate_dataset, validate_session
from .quiz_templates import SUPPORTED_LANGUAGES
from .quiz_utils import digest, hash_payload


def create_session(dataset: dict[str, Any], config: QuizConfig) -> dict[str, Any]:
    """Select and order ten questions from a validated dataset."""
    validate_dataset(dataset)
    if config.language not in SUPPORTED_LANGUAGES:
        raise ValueError("unsupported session language")
    if config.play_mode not in {"assisted", "standard", "expert"}:
        raise ValueError("unsupported play mode")
    if config.timer_seconds is not None and config.timer_seconds < 1:
        raise ValueError("timer_seconds must be greater than zero")
    if config.decade is not None and config.decade not in {1990, 2000, 2010, 2020}:
        raise ValueError("unsupported decade")
    eligible = [
        question
        for question in dataset["questions"]
        if question["language"] == config.language
        and (config.theme is None or question["theme"] == config.theme)
        and (config.group_id is None or config.group_id in question["group_ids"])
        and (config.decade is None or config.decade in question["decades"])
        and question["play_mode"] == config.play_mode
    ]
    relevance_filtered = _filter_by_group_relevance(eligible, config.play_mode)
    # A partial measurement keeps the previous pool. A filtered pool smaller
    # than ten questions also falls back, so a threshold cannot block publication.
    if len(relevance_filtered) >= 10:
        eligible = relevance_filtered
    if len(eligible) < 10:
        raise InsufficientQuestionsError(
            f"filters matched {len(eligible)} questions; a session requires 10"
        )
    eligible.sort(
        key=lambda question: digest(
            config.seed, dataset["dataset_version"], question["logical_id"]
        )
    )
    selected = [_session_question(question, config.seed) for question in eligible[:10]]
    config_payload = {
        "play_mode": config.play_mode,
        "group_id": config.group_id,
        "language": config.language,
        "seed": config.seed,
        "theme": config.theme,
        "timer_seconds": config.timer_seconds,
        "decade": config.decade,
    }
    session_id = hash_payload(
        {
            "config": config_payload,
            "dataset_version": dataset["dataset_version"],
            "question_ids": [question["id"] for question in selected],
            "schema_version": SESSION_SCHEMA_VERSION,
        }
    )
    payload = {
        "config": config_payload,
        "dataset_version": dataset["dataset_version"],
        "questions": selected,
        "schema_version": SESSION_SCHEMA_VERSION,
        "session_id": session_id,
    }
    validate_session(payload)
    return payload


def _session_question(question: dict[str, Any], seed: str) -> dict[str, Any]:
    copied = {key: value for key, value in question.items() if key != "options"}
    copied["options"] = sorted(
        question["options"],
        key=lambda option: digest(seed, question["logical_id"], option["id"]),
    )
    return copied


def _filter_by_group_relevance(
    eligible: list[dict[str, Any]], play_mode: str
) -> list[dict[str, Any]]:
    if play_mode == "standard":
        return eligible
    # Apply the threshold only when every eligible group-scoped question has a score.
    if any(
        question.get("group_ids") and question.get("group_relevance_score") is None
        for question in eligible
    ):
        return eligible
    if play_mode == "assisted":
        return [
            question for question in eligible
            if question.get("group_relevance_score") is not None
            and question["group_relevance_score"] >= ASSISTED_MIN_SCORE
        ]
    return [
        question for question in eligible
        if question.get("group_relevance_score") is not None
        and question["group_relevance_score"] <= EXPERT_MAX_SCORE
    ]
