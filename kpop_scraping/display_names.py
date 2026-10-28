"""Player-facing labels from proven Wikidata/Wikipedia names.

Display labels keep QID identity and answer keys untouched. They only adjust
casing when a locale label matches the canonical name ignoring case, and they
strip a trailing Wikipedia-style disambiguator when that does not create a
homonym among the labels published together.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

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


def strip_trailing_disambiguator(name: str) -> str:
    """Remove a final Wikipedia-style disambiguator; leave other text alone."""
    return _TRAILING_DISAMBIG.sub("", name).strip()


def align_case_to_canonical(label: str, canonical: str) -> str:
    """When label and canonical differ only by case, keep the canonical form.

    ``canonical_name`` already prefers the English Wikidata label (then other
    proven Latin sources). Reusing that casing avoids inventing a popularity
    rule while fixing locale labels such as ``shinee`` → ``SHINee``.
    """
    if label and canonical and label.casefold() == canonical.casefold():
        return canonical
    return label


def resolve_display_labels(
    entries: Sequence[tuple[str | None, str]],
) -> list[str]:
    """Resolve many labels with a shared homonym guard.

    Each entry is ``(label_or_none, canonical_name)``. Returns one display
    string per entry, in the same order. A trailing Wikipedia-style
    disambiguator is removed only when no other entry would share the same
    stripped form. Casing then follows the canonical name when they match
    ignoring case (``shinee`` / ``Luv`` → ``SHINee`` / ``LUV``).
    """
    raw = [(label or "").strip() or canonical for label, canonical in entries]
    stripped = [strip_trailing_disambiguator(value) for value in raw]
    counts: dict[str, int] = {}
    for value in stripped:
        key = value.casefold()
        counts[key] = counts.get(key, 0) + 1
    resolved: list[str] = []
    for index, (_label, canonical) in enumerate(entries):
        chosen = (
            raw[index]
            if counts[stripped[index].casefold()] > 1
            else stripped[index]
        )
        resolved.append(align_case_to_canonical(chosen, canonical))
    return resolved


def resolve_display_label(label: str | None, canonical: str) -> str:
    """Resolve one label with no peer context (safe strip when alone)."""
    return resolve_display_labels([(label, canonical)])[0]
