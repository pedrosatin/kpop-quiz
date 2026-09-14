"""Extract and normalize names and statements from Wikidata entity JSON."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

from .sources import registrable_domain


NAME_LANGUAGES = ("pt", "en", "ko")
NATIVE_NAME_PROPERTIES = ("P1559", "P1705")
ROMANIZATION_PROPERTIES = {
    "P2125": "ko-Latn-RR",  # Revised Romanization
    "P2126": "ko-Latn-MR",  # McCune-Reischauer
}
GREGORIAN_CALENDAR = "http://www.wikidata.org/entity/Q1985727"
PRECISION_YEAR = 9
PRECISION_MONTH = 10
PRECISION_DAY = 11
RANKS = ("preferred", "normal", "deprecated")

_TIME = re.compile(r"^\+(\d{4})-(\d{2})-(\d{2})T00:00:00Z$")


class TimeValueError(ValueError):
    """Raised with a stable reason code when a Wikidata time is unusable."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Alias:
    name: str
    language: str
    alias_type: str
    source_property: str | None = None


@dataclass(frozen=True)
class TimeValue:
    """A date truncated to the precision declared by Wikidata."""

    value: str
    precision: int
    calendar: str

    def components(self) -> tuple[int, ...]:
        return tuple(int(part) for part in self.value.split("-"))

    def compatible_with(self, other: "TimeValue") -> bool:
        """True when one value refines the other, such as 2015 and 2015-10."""
        mine, theirs = self.components(), other.components()
        size = min(len(mine), len(theirs))
        return mine[:size] == theirs[:size]


@dataclass(frozen=True)
class QualifierTime:
    time: TimeValue | None
    snaktype: str
    error: str | None = None


@dataclass(frozen=True)
class Reference:
    hash: str
    properties: tuple[str, ...]
    source_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class StatementIssue:
    property_id: str
    statement_id: str | None
    detail: str


@dataclass(frozen=True)
class Statement:
    statement_id: str
    property_id: str
    rank: str
    snaktype: str
    raw_value: Any
    item_id: str | None
    time: TimeValue | None
    value_error: str | None
    start_times: tuple[QualifierTime, ...]
    end_times: tuple[QualifierTime, ...]
    qualifiers: Mapping[str, Any]
    references: tuple[Reference, ...]


def canonical_name(entity: Mapping[str, Any]) -> str:
    """Prefer a Latin-script name; Korean labels come last, before the QID.

    The order is English label, Portuguese label, English and Portuguese
    aliases, romanization, English Wikipedia title and Korean label.
    """
    labels = entity.get("labels") or {}
    aliases = entity.get("aliases") or {}
    for language in ("en", "pt"):
        value = _text(labels.get(language))
        if value:
            return value
    for language in ("en", "pt"):
        for alias in aliases.get(language) or ():
            value = _text(alias)
            if value:
                return value
    for alias in extract_aliases(entity):
        if alias.alias_type == "romanization":
            return alias.name
    sitelink = _text(((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title"))
    if sitelink:
        return re.sub(r"\s+\([^)]*\)$", "", sitelink)
    return _text(labels.get("ko")) or str(entity.get("id"))


def extract_aliases(entity: Mapping[str, Any]) -> list[Alias]:
    """Return labels, aliases, native names and romanizations without duplicates."""
    found: dict[tuple[str, str, str], Alias] = {}

    def add(alias: Alias) -> None:
        key = (alias.language, alias.alias_type, alias.name)
        found.setdefault(key, alias)

    labels = entity.get("labels") or {}
    aliases = entity.get("aliases") or {}
    for language in NAME_LANGUAGES:
        label = _text(labels.get(language))
        if label:
            add(Alias(label, language, "label"))
        for item in aliases.get(language) or ():
            name = _text(item)
            if name:
                add(Alias(name, language, "alias"))

    claims = entity.get("claims") or {}
    for property_id in NATIVE_NAME_PROPERTIES:
        for statement in claims.get(property_id) or ():
            if not isinstance(statement, dict) or statement.get("rank") == "deprecated":
                continue
            value = _snak_value(statement.get("mainsnak"))
            if isinstance(value, dict) and _text(value):
                add(
                    Alias(
                        _text(value),
                        str(value.get("language") or "und"),
                        "native_name",
                        property_id,
                    )
                )
    for property_id, language in ROMANIZATION_PROPERTIES.items():
        for statement in claims.get(property_id) or ():
            if not isinstance(statement, dict) or statement.get("rank") == "deprecated":
                continue
            value = _snak_value(statement.get("mainsnak"))
            if isinstance(value, str) and value.strip():
                add(Alias(value.strip(), language, "romanization", property_id))
    return sorted(
        found.values(),
        key=lambda alias: (alias.alias_type, alias.language, alias.name),
    )


def matching_names(aliases: Iterable[Alias]) -> tuple[str, ...]:
    """Names in Latin script that can appear in an English Wikipedia extract."""
    names = {
        alias.name
        for alias in aliases
        if alias.language in {"en", "pt"} or alias.alias_type == "romanization"
    }
    return tuple(sorted(names, key=lambda name: (-len(name), name)))


def instance_of(entity: Mapping[str, Any]) -> frozenset[str]:
    return frozenset(
        statement.item_id
        for statement in parse_statements(entity, ("P31",))
        if statement.rank != "deprecated" and statement.item_id
    )


def parse_statements(
    entity: Mapping[str, Any],
    property_ids: Iterable[str],
    issues: list[StatementIssue] | None = None,
) -> list[Statement]:
    """Parse the selected claims in source order, including deprecated ones.

    Malformed statements are skipped and described in ``issues`` so that one
    bad statement does not abort the extraction of the whole run.
    """
    claims = entity.get("claims") or {}
    statements: list[Statement] = []
    for property_id in property_ids:
        for raw in claims.get(property_id) or ():
            try:
                statements.append(_parse_statement(property_id, raw))
            except ValueError as exc:
                if issues is not None:
                    statement_id = raw.get("id") if isinstance(raw, dict) else None
                    issues.append(
                        StatementIssue(
                            property_id,
                            statement_id if isinstance(statement_id, str) else None,
                            str(exc),
                        )
                    )
    return statements


def parse_time(value: Any) -> TimeValue:
    if not isinstance(value, dict):
        raise TimeValueError("invalid_time_value")
    precision = value.get("precision")
    if not isinstance(precision, int):
        raise TimeValueError("invalid_time_value")
    if precision < PRECISION_YEAR:
        raise TimeValueError("insufficient_precision")
    if precision > PRECISION_DAY:
        raise TimeValueError("unsupported_precision")
    calendar = value.get("calendarmodel")
    if calendar != GREGORIAN_CALENDAR:
        raise TimeValueError("unsupported_calendar_model")
    match = _TIME.fullmatch(str(value.get("time", "")))
    if match is None:
        raise TimeValueError("invalid_time_value")
    year, month, day = match.groups()
    if int(year) == 0:
        raise TimeValueError("invalid_time_value")
    parts = [year]
    if precision >= PRECISION_MONTH:
        if not 1 <= int(month) <= 12:
            raise TimeValueError("invalid_time_value")
        parts.append(month)
    if precision == PRECISION_DAY:
        try:
            date(int(year), int(month), int(day))
        except ValueError as exc:
            raise TimeValueError("invalid_time_value") from exc
        parts.append(day)
    return TimeValue("-".join(parts), precision, calendar)


def _parse_statement(property_id: str, raw: Any) -> Statement:
    if not isinstance(raw, dict):
        raise ValueError(f"statement of {property_id} is not an object")
    statement_id = raw.get("id")
    rank = raw.get("rank")
    if not isinstance(statement_id, str) or rank not in RANKS:
        raise ValueError(f"statement of {property_id} has no valid ID or rank")
    snak = raw.get("mainsnak")
    if not isinstance(snak, dict):
        raise ValueError(f"statement {statement_id} has no main snak")
    snaktype = str(snak.get("snaktype"))
    item_id = None
    time = None
    value_error = None
    if snaktype == "value":
        datavalue = snak.get("datavalue")
        datatype = datavalue.get("type") if isinstance(datavalue, dict) else None
        value = _snak_value(snak)
        if datatype == "wikibase-entityid" and isinstance(value, dict):
            item_id = value.get("id") if isinstance(value.get("id"), str) else None
            if item_id is None:
                value_error = "invalid_item_value"
        elif datatype == "time":
            try:
                time = parse_time(value)
            except TimeValueError as exc:
                value_error = exc.reason
        else:
            value_error = "unsupported_value_type"
    qualifiers = raw.get("qualifiers") or {}
    if not isinstance(qualifiers, dict):
        raise ValueError(f"statement {statement_id} has invalid qualifiers")
    references = tuple(
        _parse_reference(reference)
        for reference in raw.get("references") or ()
        if isinstance(reference, dict)
        and reference.get("hash")
        and isinstance(reference.get("snaks") or {}, dict)
    )
    return Statement(
        statement_id=statement_id,
        property_id=property_id,
        rank=rank,
        snaktype=snaktype,
        raw_value=snak.get("datavalue"),
        item_id=item_id,
        time=time,
        value_error=value_error,
        start_times=_qualifier_times(qualifiers.get("P580")),
        end_times=_qualifier_times(qualifiers.get("P582")),
        qualifiers=qualifiers,
        references=references,
    )


def _parse_reference(reference: Mapping[str, Any]) -> Reference:
    snaks = reference.get("snaks") or {}
    keys: list[str] = []
    for snak in snaks.get("P248") or ():
        value = _snak_value(snak)
        item_id = value.get("id") if isinstance(value, dict) else None
        if isinstance(item_id, str) and re.fullmatch(r"Q[1-9][0-9]*", item_id):
            keys.append(f"wikidata:{item_id}")
        else:
            keys.append("invalid:P248")
    for snak in snaks.get("P854") or ():
        value = _snak_value(snak)
        domain = registrable_domain(value) if isinstance(value, str) else None
        keys.append(f"domain:{domain}" if domain else "invalid:P854")
    return Reference(
        hash=str(reference.get("hash")),
        properties=tuple(sorted(snaks.keys())),
        source_keys=tuple(dict.fromkeys(keys)),
    )


def _qualifier_times(snaks: Any) -> tuple[QualifierTime, ...]:
    if not isinstance(snaks, list):
        return ()
    result = []
    for snak in snaks:
        if not isinstance(snak, dict):
            result.append(QualifierTime(None, "invalid", "invalid_qualifier"))
            continue
        snaktype = str(snak.get("snaktype"))
        if snaktype != "value":
            result.append(QualifierTime(None, snaktype))
            continue
        try:
            result.append(QualifierTime(parse_time(_snak_value(snak)), snaktype))
        except TimeValueError as exc:
            result.append(QualifierTime(None, snaktype, exc.reason))
    return tuple(result)


def _snak_value(snak: Any) -> Any:
    if not isinstance(snak, dict) or snak.get("snaktype") != "value":
        return None
    datavalue = snak.get("datavalue")
    return datavalue.get("value") if isinstance(datavalue, dict) else None


def _text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value", value.get("text"))
    return value.strip() if isinstance(value, str) else ""
