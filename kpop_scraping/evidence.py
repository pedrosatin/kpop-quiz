"""Locate evidence for fact candidates in Wikidata references and Wikipedia text."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .entities import PRECISION_DAY, PRECISION_MONTH, Statement, TimeValue
from .sources import RELIABLE, UNRELIABLE, UNREVIEWED, classify_source


EVIDENCE_RULES_VERSION = "text-evidence-v3"
MIN_NAME_LENGTH = 4
MAX_SNIPPET_LENGTH = 300
MONTHS = (
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
)
_I = re.IGNORECASE
_FORMATION_VERB = re.compile(r"\b(?:formed|founded|established|created)\b", _I)
_FORMATION_BLOCKERS = re.compile(r"\b(?:disband\w*|debut\w*|trainee\w*)", _I)
_FORMATION_OBJECT_BLOCKERS = re.compile(
    r"\b(?:agenc(?:y|ies)|compan(?:y|ies)|label|management)\b", _I
)
_NON_GROUP_HEAD_BLOCKERS = re.compile(
    r"\b(?:article|book|documentary|episode|film|song|series)\b", _I
)
_DEPENDENT_SUBJECT = re.compile(r"\b(?:who|which|that|whose)\b", _I)
_NON_GROUP_ROLE = re.compile(
    r"\b(?:choreographer|director|founder|manager|producer|stylist)\b", _I
)
_NON_MEMBER_ROLE_BEFORE = re.compile(
    r"\b(?:choreographer|director|founder|manager|producer|stylist)\s+$", _I
)
_MEMBERSHIP_OWNER_BLOCKERS = re.compile(
    r"\b(?:crew|management|managers?|producers?|staff)\b", _I
)
_MEMBER_AS_SUBJECT = re.compile(r"\bmember,?\s+[A-Z][\w'.-]*")
_PLACE_BLOCKERS = re.compile(r"\bdebut\w*", _I)
_LABEL_BLOCKERS = re.compile(r"\b(?:trainee\w*|from|former\w*)\b", _I)
_LABEL_TRIGGER = re.compile(
    r"\bsigned\s+(?:to|with)\s+", _I
)
_GROUP_NOUN = r"(?:group|band|duo|trio|quartet|quintet|act|ensemble|unit)"
_GENRE_COPULA = re.compile(r"\b(?:is|was|are|were)\s+an?\s+", _I)
_GENRE_LIST = re.compile(r"\bgenres?\s+(?:including|such\s+as|of|like)\s+", _I)
_MEMBER_LIST = re.compile(
    r"\b(?:consist(?:s|ed|ing)?\s+of|composed\s+of|comprised\s+of|members?\s*:"
    r"|line-?up\s+(?:of|:))\s*",
    _I,
)
_MEMBER_CHANGE_LIST = re.compile(r"\b(?:additions?|graduations?)\s+of\s+", _I)
# Nationality adjectives used in "<group> is a South Korean girl group".
COUNTRY_TERMS = {
    "South Korea": {
        "names": ("South Korea", "Republic of Korea", "Coreia do Sul", "República da Coreia"),
        "demonyms": ("South Korean", "sul-coreano", "sul-coreana"),
    },
    "North Korea": {
        "names": ("North Korea", "Democratic People's Republic of Korea", "Coreia do Norte"),
        "demonyms": ("North Korean", "norte-coreano", "norte-coreana"),
    },
    "Japan": {"names": ("Japan", "Japão"), "demonyms": ("Japanese", "japonês", "japonesa")},
    "China": {"names": ("China",), "demonyms": ("Chinese", "chinês", "chinesa")},
    "Taiwan": {"names": ("Taiwan",), "demonyms": ("Taiwanese", "taiwanês", "taiwanesa")},
    "Thailand": {"names": ("Thailand", "Tailândia"), "demonyms": ("Thai", "tailandês", "tailandesa")},
    "Myanmar": {"names": ("Myanmar",), "demonyms": ("Myanmar", "Burmese", "birmanês", "birmanesa")},
    "United States": {"names": ("United States", "Estados Unidos"), "demonyms": ("American", "americano", "americana")},
    "Philippines": {"names": ("Philippines", "Filipinas"), "demonyms": ("Filipino", "filipino", "filipina")},
    "Indonesia": {"names": ("Indonesia", "Indonésia"), "demonyms": ("Indonesian", "indonésio", "indonésia")},
    "Vietnam": {"names": ("Vietnam", "Vietnã"), "demonyms": ("Vietnamese", "vietnamita")},
}
_SUBJECT_PREFIX = r"(?:(?:In|On|By|Since)\b[^,]{0,40},\s*)?"
_GENERIC_SUBJECT = (
    r"(?:The\s+(?:group|band|duo|trio|quartet|quintet|sub-?group|sub-?unit|unit)|They)"
)
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[\"'(“]?[A-Z0-9])|\n+")
_SHORT_ABBREVIATION = re.compile(r"(?:^|[\s(])[A-Z][a-z]{0,2}\.$")
_CAPITALIZED_BEFORE = re.compile(r"[A-Z][\w'.-]*\s+$")
_CAPITALIZED_AFTER = re.compile(r"\s+[A-Z]")
_LIST_SEPARATOR = r"(?:\s*,\s*(?:and\s+)?|\s+and\s+)"
_PERSON_ITEM = (
    r"(?:(?:members?|siblings|leader)\s+)?"
    r"(?:[A-Z0-9][\w'.&-]*|\([^)]*\))(?:\s+(?:[A-Z0-9][\w'.&-]*|\([^)]*\)))*"
)
# Text between the list trigger and a person: an optional "six members:" and
# earlier items made of capitalized names, parentheses and separators.
_PERSON_LIST_BEFORE = re.compile(
    rf"\s*(?:[^:;,.]{{0,40}}:\s*)?(?:(?:original\s+|former\s+)?(?:members?|siblings)\s+)?"
    rf"(?:{_PERSON_ITEM}{_LIST_SEPARATOR})*"
)
_GENRE_LIST_BEFORE = re.compile(rf"\s*(?:[\w&'-]+(?:\s+[\w&'-]+){{0,2}}{_LIST_SEPARATOR})*")
_LIST_AFTER = re.compile(r"(?:\s*[,;.]|\s*$|\s+and\b|\s*\()", _I)


@dataclass(frozen=True)
class EvidenceItem:
    evidence_type: str
    locator: str
    reference_hash: str | None = None
    source_revision_id: int | None = None
    snippet: str | None = None
    source_key: str | None = None


@dataclass(frozen=True)
class ReferenceAssessment:
    """Reliable references plus the reason when none of them qualifies."""

    evidence: tuple[EvidenceItem, ...]
    rejection_reason: str | None
    sources: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class WikipediaPage:
    """Revision already collected for a catalog group, with its intro extract."""

    source_revision_id: int
    language: str
    page_id: int
    revision_id: int
    extract: str
    title: str = ""


def assess_references(statement: Statement) -> ReferenceAssessment:
    """Accept references whose cited sources are all known and reliable.

    A reference counts only when it cites P248 or P854. Each cited source is
    classified by the versioned policy in ``sources.py``.
    """
    evidence: list[EvidenceItem] = []
    sources: dict[str, str] = {}
    statuses: set[str] = set()
    for reference in statement.references:
        if not reference.source_keys:
            continue
        verdicts = [classify_source(key) for key in reference.source_keys]
        for key, verdict in zip(reference.source_keys, verdicts):
            sources[key] = verdict
        statuses.update(verdicts)
        if all(verdict == RELIABLE for verdict in verdicts):
            evidence.append(
                EvidenceItem(
                    evidence_type="wikidata_reference",
                    locator=(
                        f"claims/{statement.property_id}/{statement.statement_id}"
                        f"/references/{reference.hash}"
                    ),
                    reference_hash=reference.hash,
                    source_key=reference.source_keys[0],
                )
            )
    reason = None
    if not evidence:
        if UNREVIEWED in statuses:
            reason = "unreviewed_reference_source"
        elif UNRELIABLE in statuses:
            reason = "unreliable_reference_source"
    return ReferenceAssessment(tuple(evidence), reason, tuple(sorted(sources.items())))


def formation_date_evidence(
    page: WikipediaPage,
    value: TimeValue,
    subject_names: Sequence[str],
) -> EvidenceItem | None:
    """Accept "<group> ... formed ... in|on <date>" without another year between."""
    date = _date_pattern(value)
    for start, sentence in _subject_sentences(page, subject_names):
        for verb in _FORMATION_VERB.finditer(sentence):
            if not _formation_has_group_subject(sentence, verb.start(), subject_names):
                continue
            match = re.compile(
                rf"(?P<gap>[^.;,]{{0,60}}?)\b(?:in|on)\s+(?P<date>{date})"
            ).match(sentence, verb.end())
            if (
                match
                and not re.search(r"\d{4}", match.group("gap"))
                and not _FORMATION_BLOCKERS.search(match.group("gap"))
                and not _FORMATION_OBJECT_BLOCKERS.search(match.group("gap"))
                and not _DEPENDENT_SUBJECT.search(match.group("gap"))
            ):
                return _text_evidence(
                    page, start + match.start("date"), start + match.end("date")
                )
    return None


def place_evidence(
    page: WikipediaPage,
    names: Iterable[str],
    subject_names: Sequence[str],
    country: bool,
) -> EvidenceItem | None:
    """Accept a place directly after "formed ... in"; a country may follow a city.

    A country is also accepted as a nationality adjective between the copula
    and the group noun, as in "is a South Korean girl group".
    """
    names = list(names)
    country_names, demonyms = _reviewed_country_terms(names) if country else (names, ())
    patterns = _name_patterns(country_names)
    no_noun = rf"(?:(?!\b{_GROUP_NOUN}\b)[^.;]){{0,40}}?"
    for start, sentence in _subject_sentences(page, subject_names):
        for demonym in demonyms:
            for copula in _GENRE_COPULA.finditer(sentence):
                if not _relation_belongs_to_group(sentence, copula.start(), subject_names):
                    continue
                match = re.compile(
                    rf"{no_noun}(?<![\w-])(?P<name>{re.escape(demonym)})(?![\w-])"
                    rf"[^.;]{{0,40}}?\b{_GROUP_NOUN}\b"
                ).match(sentence, copula.end())
                if match:
                    return _text_evidence(
                        page, start + match.start("name"), start + match.end("name")
                    )
        for verb in _FORMATION_VERB.finditer(sentence):
            if not _formation_has_group_subject(sentence, verb.start(), subject_names):
                continue
            for position in _prefix_ends(sentence, verb.end(), country):
                relation = sentence[verb.end():position]
                if (
                    _FORMATION_OBJECT_BLOCKERS.search(relation)
                    or _PLACE_BLOCKERS.search(relation)
                    or _DEPENDENT_SUBJECT.search(relation)
                ):
                    continue
                found = _match_at(sentence, position, patterns)
                if found:
                    return _text_evidence(page, start + found[0], start + found[1])
    return None


def record_label_evidence(
    page: WikipediaPage,
    names: Iterable[str],
    subject_names: Sequence[str],
) -> EvidenceItem | None:
    """Accept a label named in an explicit signing relation."""
    patterns = _name_patterns(names)
    for start, sentence in _subject_sentences(page, subject_names):
        for trigger in _LABEL_TRIGGER.finditer(sentence):
            subject_region = sentence[: trigger.start()]
            if (
                not _relation_belongs_to_group(sentence, trigger.start(), subject_names)
                or _LABEL_BLOCKERS.search(subject_region)
                or re.search(r"\bmembers?\b", subject_region, _I)
            ):
                continue
            position = trigger.end()
            for _ in range(4):
                found = _match_at(sentence, position, patterns)
                if found:
                    return _text_evidence(page, start + found[0], start + found[1])
                token = re.compile(r"[^\s,.;()]+\s+").match(sentence, position)
                if token is None:
                    break
                position = token.end()
    return None


def genre_evidence(
    page: WikipediaPage,
    names: Iterable[str],
    subject_names: Sequence[str],
) -> EvidenceItem | None:
    """Accept a genre inside "is a ... <genre> group" or in a list after "genres including"."""
    patterns = _name_patterns(names)
    no_noun = rf"(?:(?!\b{_GROUP_NOUN}\b)[^.;]){{0,40}}?"
    for start, sentence in _subject_sentences(page, subject_names):
        for copula in _GENRE_COPULA.finditer(sentence):
            if not _relation_belongs_to_group(sentence, copula.start(), subject_names):
                continue
            for pattern in patterns:
                match = re.compile(
                    rf"{no_noun}(?P<name>{pattern.pattern})[^.;]{{0,20}}?\b{_GROUP_NOUN}\b", _I
                ).match(sentence, copula.end())
                if match and _clean_boundaries(
                    sentence, match.start("name"), match.end("name"), False, check_before=False
                ):
                    return _text_evidence(
                        page, start + match.start("name"), start + match.end("name")
                    )
        for listing in _GENRE_LIST.finditer(sentence):
            if not _relation_belongs_to_group(sentence, listing.start(), subject_names):
                continue
            found = _list_item(sentence, listing.end(), patterns, _GENRE_LIST_BEFORE, False)
            if found:
                return _text_evidence(page, start + found[0], start + found[1])
    return None


def membership_evidence(
    page: WikipediaPage,
    names: Iterable[str],
    subject_names: Sequence[str],
) -> EvidenceItem | None:
    """Accept a person listed after "consists of", "members:" or "line-up of".

    The forms "member <name> joined|left|departed", "<name> joined|left the
    group" and lists after "addition of" or "graduations of" are also accepted.
    """
    patterns = _name_patterns(names)
    group = _alternation(subject_names)
    for start, sentence in _subject_sentences(page, subject_names):
        for listing in _MEMBER_LIST.finditer(sentence):
            if _membership_owner_shifted(sentence, listing.start(), subject_names):
                continue
            found = _list_item(sentence, listing.end(), patterns, _PERSON_LIST_BEFORE, True)
            if found:
                return _text_evidence(page, start + found[0], start + found[1])
    for start, sentence in _subject_sentences(page, subject_names):
        if re.match(rf"^\s*{_SUBJECT_PREFIX}They\b", sentence, _I):
            continue
        for change in _MEMBER_CHANGE_LIST.finditer(sentence):
            found = _list_item(sentence, change.end(), patterns, _PERSON_LIST_BEFORE, True)
            if found:
                return _text_evidence(page, start + found[0], start + found[1])
        for pattern in patterns:
            forms = [
                rf"\bmember,?\s+(?P<name>{pattern.pattern}),?\s+(?:joined|left|departed)\b",
                rf"(?P<name>{pattern.pattern}),?\s+(?:joined|left|departed(?:\s+from)?)\s+"
                rf"the\s+group",
            ]
            for form in forms:
                for match in re.finditer(form, sentence, _I):
                    if (
                        not _ambiguous_membership_context(sentence, match.start("name"))
                        and _clean_boundaries(
                            sentence, match.start("name"), match.end("name"), True
                        )
                    ):
                        return _text_evidence(
                            page, start + match.start("name"), start + match.end("name")
                        )
    exact_group = re.compile(rf"(?:the\s+)?(?:group\s+)?(?:{group})(?![\w'-])", _I)
    for start, end in _sentences(page.extract):
        sentence = page.extract[start:end]
        for pattern in patterns:
            form = re.compile(
                rf"(?P<name>{pattern.pattern}),?\s+(?:joined|left|departed(?:\s+from)?)\s+"
            )
            for match in form.finditer(sentence):
                target = exact_group.match(sentence, match.end())
                if (
                    target
                    and not _ambiguous_membership_context(sentence, match.start("name"))
                    and _clean_boundaries(sentence, match.start("name"), match.end("name"), True)
                ):
                    return _text_evidence(
                        page, start + match.start("name"), start + match.end("name")
                    )
    return None


def text_evidence(
    predicate: str,
    page: WikipediaPage,
    subject_names: Sequence[str],
    value_names: Iterable[str],
    time: TimeValue | None = None,
) -> EvidenceItem | None:
    """Apply the rule of one predicate to the group's Wikipedia extract.

    For ``member_of`` the value names are the person's names, because the page
    belongs to the group.
    """
    subject = subject_names_for(page, subject_names)
    if predicate == "formed_on":
        return formation_date_evidence(page, time, subject) if time else None
    if predicate in {"formed_in", "origin_country"}:
        return place_evidence(page, value_names, subject, predicate == "origin_country")
    if predicate == "record_label":
        return record_label_evidence(page, value_names, subject)
    if predicate == "genre":
        return genre_evidence(page, value_names, subject)
    if predicate in {"has_member", "member_of"}:
        return membership_evidence(page, value_names, subject)
    return None


def subject_names_for(page: WikipediaPage, names: Iterable[str]) -> tuple[str, ...]:
    title = re.sub(r"\s+\([^)]*\)$", "", page.title).strip()
    values = {name.strip() for name in names if name.strip()}
    if title:
        values.add(title)
    return tuple(sorted(values, key=lambda name: (-len(name), name)))


def _subject_sentences(
    page: WikipediaPage,
    subject_names: Sequence[str],
) -> Iterable[tuple[int, str]]:
    for start, end in _sentences(page.extract):
        sentence = page.extract[start:end]
        if _leading_subject(sentence, subject_names):
            yield start, sentence


def _leading_subject(
    sentence: str,
    subject_names: Sequence[str],
) -> re.Match[str] | None:
    names = _alternation(subject_names)
    return re.compile(
        rf"^\s*{_SUBJECT_PREFIX}(?:{names}|{_GENERIC_SUBJECT})(?![\w'-])", _I
    ).match(sentence)


def _alternation(names: Iterable[str]) -> str:
    escaped = [re.escape(name) for name in names if name]
    return "|".join(escaped) if escaped else r"(?!)"


def _name_patterns(names: Iterable[str]) -> list[re.Pattern[str]]:
    usable = sorted(
        {
            name.strip()
            for name in names
            if len(name.strip()) >= MIN_NAME_LENGTH or " " in name.strip()
        },
        key=lambda name: (-len(name), name),
    )
    # Hyphens count as part of a word, so "pop" does not match "K-pop".
    return [re.compile(rf"(?<![\w-]){re.escape(name)}(?![\w-])", _I) for name in usable]


def _match_at(
    sentence: str,
    position: int,
    patterns: list[re.Pattern[str]],
) -> tuple[int, int] | None:
    for pattern in patterns:
        match = pattern.match(sentence, position)
        if match and _clean_boundaries(sentence, match.start(), match.end(), False):
            return match.start(), match.end()
    return None


def _list_item(
    sentence: str,
    position: int,
    patterns: list[re.Pattern[str]],
    before_pattern: re.Pattern[str],
    proper_noun: bool,
) -> tuple[int, int] | None:
    """Find a name that starts an item of the list beginning at ``position``."""
    region_end = sentence.find(";", position)
    region_end = len(sentence) if region_end < 0 else region_end
    region = sentence[:region_end]
    for pattern in patterns:
        for match in pattern.finditer(region, position):
            if not before_pattern.fullmatch(region, position, match.start()):
                continue
            if not _LIST_AFTER.match(region, match.end()):
                continue
            # List items are separated by commas, so the name only needs to
            # avoid a capitalized continuation such as "Warner Music Japan".
            if _clean_boundaries(sentence, match.start(), match.end(), proper_noun, False):
                return match.start(), match.end()
    return None


def _clean_boundaries(
    sentence: str,
    start: int,
    end: int,
    proper_noun: bool,
    check_before: bool = True,
) -> bool:
    """Reject partial names such as "Warner Music" in "Warner Music Japan"."""
    if proper_noun and sentence[start].islower():
        return False
    if _CAPITALIZED_AFTER.match(sentence, end):
        return False
    return not (check_before and _CAPITALIZED_BEFORE.search(sentence[:start]))


def _prefix_ends(sentence: str, position: int, country: bool) -> list[int]:
    """Positions right after "in " or, for countries, after "in <City>, "."""
    ends = []
    for match in re.finditer(r"\bin\s+", sentence[position : position + 80]):
        absolute = position + match.end()
        if re.search(r"[.;,]", sentence[position:absolute]):
            break
        ends.append(absolute)
        if country:
            city = re.compile(r"[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2},\s+").match(
                sentence, absolute
            )
            if city:
                ends.append(city.end())
    return ends


def _is_appositive(sentence: str, verb_start: int) -> bool:
    return sentence[:verb_start].rstrip().endswith(",")


def _formation_has_group_subject(
    sentence: str,
    verb_start: int,
    subject_names: Sequence[str],
) -> bool:
    """Require the formation verb to describe the leading group subject."""
    subject = _leading_subject(sentence, subject_names)
    if subject is None or _is_appositive(sentence, verb_start):
        return False
    relation_head = sentence[subject.end():verb_start]
    if relation_head.lstrip().startswith(("'s", "’s")):
        return False
    return not (
        _FORMATION_OBJECT_BLOCKERS.search(relation_head)
        or _NON_GROUP_HEAD_BLOCKERS.search(relation_head)
        or _MEMBER_AS_SUBJECT.search(relation_head)
        or _NON_GROUP_ROLE.search(relation_head)
        or _DEPENDENT_SUBJECT.search(relation_head)
    )


def _relation_belongs_to_group(
    sentence: str,
    relation_start: int,
    subject_names: Sequence[str],
) -> bool:
    """Reject a relation whose grammatical subject shifted away from the group."""
    subject = _leading_subject(sentence, subject_names)
    if subject is None:
        return False
    relation_head = sentence[subject.end():relation_start]
    return not (
        _DEPENDENT_SUBJECT.search(relation_head)
        or _NON_GROUP_HEAD_BLOCKERS.search(relation_head)
        or _FORMATION_OBJECT_BLOCKERS.search(relation_head)
        or _NON_GROUP_ROLE.search(relation_head)
        or re.search(r"\bmembers?\b", relation_head, _I)
    )


def _membership_owner_shifted(
    sentence: str,
    relation_start: int,
    subject_names: Sequence[str],
) -> bool:
    subject = _leading_subject(sentence, subject_names)
    if subject is None:
        return True
    return bool(_MEMBERSHIP_OWNER_BLOCKERS.search(sentence[subject.end():relation_start]))


def _reviewed_country_terms(names: Iterable[str]) -> tuple[list[str], tuple[str, ...]]:
    """Return only country names and demonyms reviewed in this module."""
    supplied = {name.casefold() for name in names}
    explicit: set[str] = set()
    demonyms: set[str] = set()
    for canonical, terms in COUNTRY_TERMS.items():
        reviewed_names = {canonical, *terms["names"]}
        if supplied.isdisjoint(name.casefold() for name in reviewed_names):
            continue
        explicit.update(reviewed_names)
        demonyms.update(terms["demonyms"])
    return (
        sorted(explicit, key=lambda value: (-len(value), value)),
        tuple(sorted(demonyms, key=lambda value: (-len(value), value))),
    )


def _ambiguous_membership_context(sentence: str, member_start: int) -> bool:
    context = sentence[:member_start]
    return bool(
        _NON_GROUP_HEAD_BLOCKERS.search(context)
        or _NON_MEMBER_ROLE_BEFORE.search(context)
        or re.search(r"\banother\s+(?:act|band|duo|group|unit)\b", context, _I)
    )


def _date_pattern(value: TimeValue) -> str:
    parts = value.components()
    year = rf"{parts[0]}(?![\d-])"
    if value.precision < PRECISION_MONTH:
        return year
    month = MONTHS[parts[1] - 1]
    if value.precision < PRECISION_DAY:
        return rf"{month},?\s+{year}"
    day = parts[2]
    return rf"(?:{month}\s+0?{day},?\s+{year}|0?{day}\s+{month},?\s+{year})"


def _sentences(text: str) -> list[tuple[int, int]]:
    spans = []
    start = 0
    for boundary in _SENTENCE_BOUNDARY.finditer(text):
        # "Jun. K" and "U.S." do not end a sentence.
        if "\n" not in boundary.group(0) and _SHORT_ABBREVIATION.search(
            text[start : boundary.start()]
        ):
            continue
        spans.append((start, boundary.start()))
        start = boundary.end()
    spans.append((start, len(text)))
    return [(begin, end) for begin, end in spans if text[begin:end].strip()]


def _text_evidence(page: WikipediaPage, start: int, end: int) -> EvidenceItem:
    snippet = page.extract
    for begin, finish in _sentences(page.extract):
        if begin <= start < finish:
            snippet = page.extract[begin:finish]
            break
    snippet = snippet.strip()
    if len(snippet) > MAX_SNIPPET_LENGTH:
        snippet = snippet[: MAX_SNIPPET_LENGTH - 3].rstrip() + "..."
    return EvidenceItem(
        evidence_type="wikipedia_revision",
        locator=(
            f"wikipedia:{page.language}:pageid={page.page_id}:revid={page.revision_id}"
            f"#extract[{start}:{end}]"
        ),
        source_revision_id=page.source_revision_id,
        snippet=snippet,
        source_key=f"wikipedia:{page.language}",
    )
