"""Read fields of an infobox from a revision's wikitext.

Groups use the first ``Infobox musical artist``. A person's own page uses its
first infobox of any kind, accepted only when it is ``Infobox person`` or
``Infobox musical artist``. The parser keeps every item as a span of the
original wikitext, so evidence can point to the exact characters that name a
label, a member, a date or a place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

INFOBOX_START = re.compile(r"\{\{\s*Infobox[ _]+musical[ _]+artist\s*(?=[|}<\n])", re.I)
# Any infobox opening; the name ends at a parameter, the closing braces or a break.
_ANY_INFOBOX_START = re.compile(r"\{\{\s*Infobox(?:[ _]+([^|{}<\n]*?))?\s*(?=[|}<\n])", re.I)
_INERT_TEXT = re.compile(r"<!--.*?-->|<nowiki\b[^>]*>.*?</nowiki\s*>", re.I | re.S)
# Templates that only wrap a list; their arguments are the list items.
LIST_TEMPLATES = frozenset({
    "hlist", "flatlist", "plainlist", "ubl", "unbulleted list", "ublist",
    "bulleted list", "blist", "collapsible list", "ordered list",
})
_TEMPLATE_NAME = re.compile(r"\{\{\s*([^|{}]+?)\s*(?=\||\}\})")
_ITEM_BREAK = re.compile(r"<br\s*/?>|\n|,|•|·", re.I)
_REF = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.I | re.S)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_TAG = re.compile(r"</?[a-z][^>]*>", re.I)
_LINK = re.compile(r"\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]")
_TRAILING_NOTE = re.compile(r"\s*\([^()]*\)\s*$")


@dataclass(frozen=True)
class InfoboxItem:
    """One list item: the names it gives and its span in the wikitext."""

    names: tuple[str, ...]
    start: int
    end: int
    text: str


def infobox_fields(wikitext: str) -> dict[str, tuple[int, int]]:
    """Return the value span of each named parameter of the first musical artist infobox."""
    match = INFOBOX_START.search(wikitext)
    if match is None:
        return {}
    return _fields_of(wikitext, match.start(), match.end())


def first_infobox_fields(
    wikitext: str,
    accepted_types: frozenset[str],
) -> dict[str, tuple[int, int]]:
    """Return the fields of the page's first infobox, if its type is accepted.

    Only the first infobox of the page counts, whatever its type: when it is
    not one of ``accepted_types`` (lowercase, single spaces) the page has no
    fields, instead of falling through to a later infobox. Commented-out and
    ``<nowiki>`` infoboxes are ignored.
    """
    inert = _INERT_TEXT.sub(lambda found: " " * len(found.group(0)), wikitext)
    match = _ANY_INFOBOX_START.search(inert)
    if match is None:
        return {}
    kind = " ".join((match.group(1) or "").replace("_", " ").split()).lower()
    if kind not in accepted_types:
        return {}
    return _fields_of(wikitext, match.start(), match.end())


def _fields_of(wikitext: str, template_start: int, parameters_start: int) -> dict[str, tuple[int, int]]:
    end = _closing_braces(wikitext, template_start)
    if end is None:
        return {}
    fields: dict[str, tuple[int, int]] = {}
    for start, stop in _split_top_level(wikitext, parameters_start, end - 2, "|"):
        equals = wikitext.find("=", start, stop)
        if equals < 0 or _depth_before(wikitext, start, equals):
            continue
        name = wikitext[start:equals].strip().lower().replace(" ", "_")
        if name and name not in fields:
            fields[name] = (equals + 1, stop)
    return fields


def field_items(
    wikitext: str,
    span: tuple[int, int],
    include_unreadable: bool = False,
) -> list[InfoboxItem]:
    """Split a field value into items, unwrapping list templates.

    An item that names nothing, such as one with extra text around its link,
    is left out unless ``include_unreadable`` asks for it with empty ``names``.
    """
    items: list[InfoboxItem] = []
    for start, end in _item_spans(wikitext, *span):
        names = _item_names(wikitext[start:end])
        if names or include_unreadable:
            items.append(InfoboxItem(names, start, end, wikitext[start:end].strip()))
    return items


def _item_spans(text: str, start: int, end: int) -> list[tuple[int, int]]:
    start, end = _trim(text, start, end)
    if start >= end:
        return []
    wrapper = _list_wrapper(text, start, end)
    if wrapper is not None:
        name_end, close = wrapper
        spans: list[tuple[int, int]] = []
        for arg_start, arg_end in _split_top_level(text, name_end, close - 2, "|"):
            if _is_named_argument(text, arg_start, arg_end):
                continue
            spans.extend(_item_spans(text, arg_start, arg_end))
        return spans
    spans = []
    for piece_start, piece_end in _split_top_level(text, start, end, _ITEM_BREAK):
        piece_start, piece_end = _trim(text, piece_start, piece_end)
        while piece_start < piece_end and text[piece_start] in "*#":
            piece_start += 1
        piece_start, piece_end = _trim(text, piece_start, piece_end)
        if piece_start >= piece_end:
            continue
        if _list_wrapper(text, piece_start, piece_end) is not None:
            spans.extend(_item_spans(text, piece_start, piece_end))
        else:
            spans.append((piece_start, piece_end))
    return spans


def _list_wrapper(text: str, start: int, end: int) -> tuple[int, int] | None:
    """Return where the arguments begin and the template closes, if the span is a list template.

    Comments around the template are not part of the list, so ``{{hlist|...}}
    <!-- note -->`` still counts as a whole list. Both positions stay offsets
    of the original text, which evidence locators rely on.
    """
    start, end = _skip_comments(text, start, end)
    name = _TEMPLATE_NAME.match(text, start, end)
    if name is None or name.group(1).strip().lower() not in LIST_TEMPLATES:
        return None
    close = _closing_braces(text, start)
    return (name.end(), close) if close == end else None


def _skip_comments(text: str, start: int, end: int) -> tuple[int, int]:
    """Narrow ``text[start:end]`` past comments at either edge, and the space between."""
    while True:
        start, end = _trim(text, start, end)
        if text.startswith("<!--", start) and (close := text.find("-->", start, end)) >= 0:
            start = close + 3
        elif text.endswith("-->", start, end) and (open_ := text.rfind("<!--", start, end - 3)) >= 0:
            end = open_
        else:
            return start, end


def _item_names(raw: str) -> tuple[str, ...]:
    text = _COMMENT.sub("", _REF.sub("", raw))
    text = _strip_templates(text)
    text = _TAG.sub("", text).strip()
    if not text:
        return ()
    links = list(_LINK.finditer(text))
    names: list[str] = []
    if links:
        # A link counts only when it is the whole item, apart from a note.
        outside = _TRAILING_NOTE.sub("", _LINK.sub("", text)).strip(" '\"")
        if outside or len(links) != 1:
            return ()
        target, label = links[0].group(1), links[0].group(2)
        target = target.split("#", 1)[0].replace("_", " ").strip()
        if target and ":" not in target:
            names.append(target)
        if label and label.strip():
            names.append(label.strip())
    else:
        plain = _TRAILING_NOTE.sub("", text).strip(" '\"")
        if plain and not re.search(r"[\[\]{}|=]", plain):
            names.append(plain)
    return tuple(dict.fromkeys(name for name in names if name))


def _strip_templates(text: str) -> str:
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    return text


def _is_named_argument(text: str, start: int, end: int) -> bool:
    equals = text.find("=", start, end)
    if equals < 0 or _depth_before(text, start, equals):
        return False
    return bool(re.fullmatch(r"\s*[\w -]+\s*", text[start:equals]))


def _trim(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _closing_braces(text: str, start: int) -> int | None:
    """Return the index just after the template that opens at ``start``."""
    depth = 0
    index = start
    while index < len(text):
        pair = text[index:index + 2]
        if pair == "{{":
            depth += 1
            index += 2
        elif pair == "}}":
            depth -= 1
            index += 2
            if depth == 0:
                return index
        else:
            index += 1
    return None


def _depth_before(text: str, start: int, stop: int) -> bool:
    """Return True when ``stop`` sits inside a template or link opened after ``start``."""
    depth = 0
    index = start
    while index < stop:
        pair = text[index:index + 2]
        if pair in ("{{", "[["):
            depth += 1
            index += 2
        elif pair in ("}}", "]]"):
            depth -= 1
            index += 2
        else:
            index += 1
    return depth > 0


def _split_top_level(
    text: str,
    start: int,
    end: int,
    separator: str | re.Pattern[str],
) -> list[tuple[int, int]]:
    """Split ``text[start:end]`` on separators outside templates, links and tags."""
    spans: list[tuple[int, int]] = []
    depth = 0
    piece_start = start
    index = start
    while index < end:
        pair = text[index:index + 2]
        if pair in ("{{", "[["):
            depth += 1
            index += 2
            continue
        if pair in ("}}", "]]"):
            depth = max(0, depth - 1)
            index += 2
            continue
        if depth == 0:
            if text.startswith("<ref", index) and not text.startswith("<references", index):
                closing = _ref_end(text, index, end)
                index = closing
                continue
            if text.startswith("<!--", index):
                closing = text.find("-->", index, end)
                index = end if closing < 0 else closing + 3
                continue
            if isinstance(separator, str):
                if text.startswith(separator, index):
                    spans.append((piece_start, index))
                    index += len(separator)
                    piece_start = index
                    continue
            else:
                found = separator.match(text, index, end)
                if found and found.end() > index:
                    spans.append((piece_start, index))
                    index = found.end()
                    piece_start = index
                    continue
        index += 1
    spans.append((piece_start, end))
    return spans


def _ref_end(text: str, start: int, end: int) -> int:
    tag_end = text.find(">", start, end)
    if tag_end < 0:
        return end
    if text[tag_end - 1] == "/":
        return tag_end + 1
    closing = text.lower().find("</ref>", tag_end, end)
    return end if closing < 0 else closing + len("</ref>")
