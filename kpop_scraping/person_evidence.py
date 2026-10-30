"""Prove a person's birth date and place with the infobox of their own page.

Only two fields of the first infobox of the person's own English Wikipedia
page count: ``birth_date`` for ``born_on`` and ``birth_place`` for ``born_in``.
The infobox type must be ``Infobox person`` or ``Infobox musical artist``, and
the page must declare the person's Wikidata item and not be a redirect. The
summary, the body, categories and group pages never prove a person's
attribute (ADR 027).

The rule fails closed. A value the infobox states differently is a rejection
with its own reason, and a field that cannot be read without guessing is an
ambiguous rejection, never an acceptance.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from .entities import GREGORIAN_CALENDAR, PRECISION_DAY, PRECISION_YEAR, TimeValue
from .evidence import MONTHS, EvidenceItem, WikipediaPage, infobox_item_evidence
from .infobox import _closing_braces, _split_top_level, field_items, first_infobox_fields

PERSON_INFOBOX_TYPES = frozenset({"person", "musical artist"})
PERSON_BIRTH_FIELDS = {"born_on": "birth_date", "born_in": "birth_place"}
VALUE_DIFFERS = "wikipedia_value_differs"
VALUE_AMBIGUOUS = "wikipedia_value_ambiguous"
COARSE_PLACE = "coarse_place"

# Birth date templates whose positional arguments are year, month and day.
_BIRTH_TEMPLATES = frozenset({"birth date", "birth date and age", "bda", "dob"})
# Display options of those templates; they do not change the date.
_DISPLAY_OPTIONS = frozenset({"df", "mf"})
_MARKUP = re.compile(
    r"<!--.*?-->|<ref[^>/]*/>|<ref[^>]*>.*?</ref\s*>|</?[a-z][^>]*>", re.I | re.S
)
_TRAILING_NOTE = re.compile(r"\s*\([^()]*\)\s*$")
_TRAILING_REFS = re.compile(
    r"(?:\s*(?:<!--.*?-->|<ref[^>/]*/>|<ref[^>]*>.*?</ref\s*>))+\s*$", re.I | re.S
)
_PIPED_LINK = re.compile(r"\[\[(?:[^\[\]|]*\|)?([^\[\]|]*)\]\]")
_MONTH_NUMBER = {name.lower(): number for number, name in enumerate(MONTHS, start=1)}
_MONTH_NAMES = "|".join(MONTHS)
_WRITTEN_DATES = (
    re.compile(rf"(?P<month>{_MONTH_NAMES})\s+(?P<day>\d{{1,2}}),?\s+(?P<year>\d{{4}})", re.I),
    re.compile(rf"(?P<day>\d{{1,2}})\s+(?P<month>{_MONTH_NAMES}),?\s+(?P<year>\d{{4}})", re.I),
    re.compile(r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})"),
)


@dataclass(frozen=True)
class PersonInfoboxCheck:
    """Outcome of reading one infobox field against a Wikidata value.

    ``evidence`` proves the value. ``rejection_reason`` is set when the field
    exists but does not prove it, and ``observed`` then carries the field as
    it was read so a reviewer can see what the page says. With neither, the
    page has nothing to say about the value.
    """

    evidence: EvidenceItem | None = None
    rejection_reason: str | None = None
    observed: EvidenceItem | None = None


def person_infobox_check(
    predicate: str,
    page: WikipediaPage,
    subject_id: str,
    time: TimeValue | None = None,
    value_names: Iterable[str] = (),
) -> PersonInfoboxCheck:
    """Compare ``birth_date`` or ``birth_place`` with a Wikidata fact value."""
    field = PERSON_BIRTH_FIELDS.get(predicate)
    if field is None or not page.wikitext:
        return PersonInfoboxCheck()
    # The collector already checked the identity; a wrong page must still fail here.
    if page.is_redirect or not subject_id or page.wikidata_id != subject_id:
        return PersonInfoboxCheck()
    span = first_infobox_fields(page.wikitext, PERSON_INFOBOX_TYPES).get(field)
    if span is None:
        return PersonInfoboxCheck()
    if predicate == "born_on":
        return _birth_date_check(page, field, span, time)
    return _birth_place_check(page, field, span, value_names)


def _birth_date_check(
    page: WikipediaPage,
    field: str,
    span: tuple[int, int],
    time: TimeValue | None,
) -> PersonInfoboxCheck:
    # Month precision and anything outside the gate are left without a verdict.
    if (
        time is None
        or time.calendar != GREGORIAN_CALENDAR
        or time.precision not in (PRECISION_YEAR, PRECISION_DAY)
    ):
        return PersonInfoboxCheck()
    visible = _visible(page.wikitext, span)
    if visible is None:
        return PersonInfoboxCheck()
    start, end = visible
    stated = _stated_date(page.wikitext, start, end)
    item = infobox_item_evidence(page, field, start, end)
    if stated is None:
        return PersonInfoboxCheck(rejection_reason=VALUE_AMBIGUOUS, observed=item)
    expected = time.components()
    if stated[: len(expected)] == expected:
        return PersonInfoboxCheck(evidence=item)
    return PersonInfoboxCheck(rejection_reason=VALUE_DIFFERS, observed=item)


def _birth_place_check(
    page: WikipediaPage,
    field: str,
    span: tuple[int, int],
    value_names: Iterable[str],
) -> PersonInfoboxCheck:
    wanted = {
        " ".join(name.split()).casefold()
        for name in value_names
        if len(name.strip()) >= 2
    }
    if not wanted:
        return PersonInfoboxCheck()
    items = [
        item
        for item in field_items(page.wikitext, span, include_unreadable=True)
        if item.names or _mask(page.wikitext[item.start : item.end]).strip()
    ]
    if not items:
        return _unreadable_field(page, field, span)
    for position, item in enumerate(items):
        if any(" ".join(name.split()).casefold() in wanted for name in item.names):
            start, end = _without_trailing_notes(page.wikitext, item.start, item.end)
            found = infobox_item_evidence(page, field, start, end)
            # An item before the match is more specific, so the value is coarser.
            return PersonInfoboxCheck(
                evidence=found if position == 0 else _flagged(found, COARSE_PLACE)
            )
    first, last = items[0].start, items[-1].end
    observed = infobox_item_evidence(
        page, field, *_without_trailing_notes(page.wikitext, first, last)
    )
    # An item the rule cannot read, or one that qualifies the value ("Nam
    # District, Busan" for "Nam District"), may or may not name the same
    # place, so it is no divergence.
    unclear = any(not item.names or _qualifies(item.names, wanted) for item in items)
    return PersonInfoboxCheck(
        rejection_reason=VALUE_AMBIGUOUS if unclear else VALUE_DIFFERS, observed=observed
    )


def _qualifies(names: Iterable[str], wanted: set[str]) -> bool:
    """True when a name is a wanted name followed by a comma and more text."""
    return any(
        "," in name and " ".join(name.split(",", 1)[0].split()).casefold() in wanted
        for name in names
    )


def _unreadable_field(
    page: WikipediaPage, field: str, span: tuple[int, int]
) -> PersonInfoboxCheck:
    """A field with text that yields no item is ambiguous; an empty one says nothing."""
    visible = _visible(page.wikitext, span)
    if visible is None:
        return PersonInfoboxCheck()
    return PersonInfoboxCheck(
        rejection_reason=VALUE_AMBIGUOUS,
        observed=infobox_item_evidence(page, field, *visible),
    )


def _flagged(item: EvidenceItem, flag: str) -> EvidenceItem:
    return EvidenceItem(
        item.evidence_type,
        item.locator,
        item.reference_hash,
        item.source_revision_id,
        item.snippet,
        item.source_key,
        (*item.flags, flag),
    )


def _visible(wikitext: str, span: tuple[int, int]) -> tuple[int, int] | None:
    """Return the field text without references, comments and tags, or None when blank."""
    masked = _mask(wikitext[span[0] : span[1]])
    stripped = masked.strip()
    if not stripped:
        return None
    start = span[0] + len(masked) - len(masked.lstrip())
    return start, start + len(stripped)


def _mask(text: str) -> str:
    """Blank references, comments and tags, keeping every other offset."""
    return _MARKUP.sub(lambda found: " " * len(found.group(0)), text)


def _stated_date(wikitext: str, start: int, end: int) -> tuple[int, ...] | None:
    """Read the one date a ``birth_date`` value states, or None when it is not clear."""
    body = _mask(wikitext[start:end])
    body = _TRAILING_NOTE.sub("", body).strip()
    if body.startswith("{{"):
        close = _closing_braces(body, 0)
        if close != len(body):
            return None
        return _template_date(body)
    unlinked = _PIPED_LINK.sub(r"\1", body)
    for pattern in _WRITTEN_DATES:
        found = pattern.fullmatch(unlinked.strip())
        if found:
            month = found.group("month")
            number = int(month) if month.isdigit() else _MONTH_NUMBER[month.lower()]
            return _calendar_date(int(found.group("year")), number, int(found.group("day")))
    return None


def _template_date(template: str) -> tuple[int, ...] | None:
    pieces = _split_top_level(template, 2, len(template) - 2, "|")
    name = " ".join(template[pieces[0][0] : pieces[0][1]].replace("_", " ").split()).lower()
    if name not in _BIRTH_TEMPLATES:
        return None
    positional: list[str] = []
    for begin, finish in pieces[1:]:
        argument = template[begin:finish].strip()
        key, equals, _ = argument.partition("=")
        if equals and key.strip().lower() in _DISPLAY_OPTIONS:
            continue
        if equals or not argument.isdigit():
            return None
        positional.append(argument)
    if len(positional) != 3:
        return None
    year, month, day = (int(part) for part in positional)
    return _calendar_date(year, month, day)


def _calendar_date(year: int, month: int, day: int) -> tuple[int, ...] | None:
    try:
        date(year, month, day)
    except ValueError:
        return None
    return year, month, day


def _without_trailing_notes(wikitext: str, start: int, end: int) -> tuple[int, int]:
    """Cut the references and comments that follow an item out of its span."""
    chunk = wikitext[start:end]
    found = _TRAILING_REFS.search(chunk)
    if found:
        chunk = chunk[: found.start()]
    return start, start + len(chunk.rstrip())
