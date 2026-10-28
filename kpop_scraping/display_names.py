"""Player-facing labels from proven Wikidata/Wikipedia names.

Display labels keep QID identity and answer keys untouched. They strip a
trailing Wikipedia-style disambiguator when that does not create a homonym
among the labels published together, and apply reviewed per-entity overrides.

No casing is inferred: a locale label that differs from ``canonical_name``
only by case keeps the published spelling, because neither side is a proven
authority (``izna`` and ``tripleS`` are correct as published). A spelling is
changed only by an entry in ``display-label-overrides.json`` that cites a
pinned source revision.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

OVERRIDES_PATH = (
    Path(__file__).resolve().parent.parent
    / "web"
    / "src"
    / "data"
    / "display-label-overrides.json"
)

# Wikipedia-style notes only. Keeps f(x), +(Kr)ystal Eyes, and other
# intentional parentheses that are part of the name.
_TRAILING_DISAMBIG = re.compile(
    r"\s+\((?:"
    r"grupo(?:\s+musical)?(?:\s+sul-coreano)?"
    r"|banda"
    r"|group(?:\s+sul-coreano)?"
    r"|musical\s+group"
    r"|band"
    r"|girl\s+group"
    r"|boy\s+band"
    r"|south\s+korean\s+band"
    r"|south\s+korean\s+group"
    r")\)$",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def _load_overrides() -> dict[tuple[str, str], tuple[str, str]]:
    """Map ``(qid, locale)`` to ``(published, display)``."""
    payload = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    table: dict[tuple[str, str], tuple[str, str]] = {}
    for entry in payload["overrides"]:
        if not entry.get("evidence"):
            raise ValueError(
                f"Display override {entry['qid']}/{entry['locale']} has no evidence"
            )
        table[(entry["qid"], entry["locale"])] = (entry["published"], entry["display"])
    return table


def strip_trailing_disambiguator(name: str) -> str:
    """Remove a final Wikipedia-style disambiguator; leave other text alone."""
    return _TRAILING_DISAMBIG.sub("", name).strip()


def apply_override(label: str, qid: str | None, locale: str | None) -> str:
    """Return the reviewed display spelling when ``label`` is the published one."""
    if not qid or not locale:
        return label
    override = _load_overrides().get((qid, locale))
    if override is not None and label == override[0]:
        return override[1]
    return label


def resolve_display_labels(
    entries: Sequence[tuple[str | None, str, str | None]],
    locale: str | None = None,
) -> list[str]:
    """Resolve many labels with a shared homonym guard.

    Each entry is ``(label_or_none, canonical_name, qid_or_none)``. Returns one
    display string per entry, in the same order. A trailing Wikipedia-style
    disambiguator is removed only when no other entry would share the same
    stripped form (compared ignoring case). Reviewed overrides apply last and
    only when ``locale`` is given.
    """
    raw = [(label or "").strip() or canonical for label, canonical, _qid in entries]
    stripped = [strip_trailing_disambiguator(value) for value in raw]
    counts: dict[str, int] = {}
    for value in stripped:
        key = value.casefold()
        counts[key] = counts.get(key, 0) + 1
    resolved: list[str] = []
    for index, (_label, _canonical, qid) in enumerate(entries):
        chosen = (
            raw[index]
            if counts[stripped[index].casefold()] > 1
            else stripped[index]
        )
        resolved.append(apply_override(chosen, qid, locale))
    return resolved
