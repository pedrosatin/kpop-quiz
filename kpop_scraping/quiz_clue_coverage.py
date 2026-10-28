"""Report how many published quiz questions carry a clue."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MANIFEST_FILENAME = "manifest-v2.json"
PLAY_MODES = ("assisted", "standard", "expert")


def session_clue_coverage(sessions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Count questions and sessions with a clue, by play mode.

    Expert sessions have no clues by design and are reported apart from the
    modes that offer them.
    """
    by_mode: dict[str, dict[str, int]] = {
        mode: {"sessions": 0, "sessions_with_clue": 0, "questions": 0, "with_clue": 0}
        for mode in PLAY_MODES
    }
    without_clue: list[str] = []
    for key in sorted(sessions):
        questions = sessions[key]["questions"]
        mode = sessions[key]["config"]["play_mode"]
        with_clue = sum(bool(question["clues_available"]) for question in questions)
        item = by_mode[mode]
        item["sessions"] += 1
        item["sessions_with_clue"] += bool(with_clue)
        item["questions"] += len(questions)
        item["with_clue"] += with_clue
        if mode != "expert" and not with_clue:
            without_clue.append(key)
    return {"by_mode": by_mode, "sessions_without_clue": without_clue}


def published_clue_coverage(directory: Path) -> dict[str, Any]:
    """Read the sessions a verified manifest lists and count their clues."""
    manifest = json.loads((directory / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    sessions = {
        key: json.loads((directory / entry["path"]).read_text(encoding="utf-8"))
        for key, entry in manifest["sessions"].items()
    }
    return session_clue_coverage(sessions)


def format_clue_coverage(coverage: dict[str, Any], label: str) -> list[str]:
    lines = []
    for mode in PLAY_MODES:
        item = coverage["by_mode"][mode]
        if mode == "expert":
            lines.append(f"{label} expert: {item['sessions']} sessions, no clues by design")
            continue
        lines.append(
            f"{label} {mode}: {item['with_clue']}/{item['questions']} questions with a clue, "
            f"{item['sessions_with_clue']}/{item['sessions']} sessions with at least one"
        )
    missing = coverage["sessions_without_clue"]
    if missing:
        lines.append(f"{label} sessions without any clue: {', '.join(missing)}")
    return lines
