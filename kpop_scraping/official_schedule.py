"""Extract tour dates from the official YG schedule page.

The page lists one block per destination: a ``p.city`` label, a ``p.place``
venue label and ``p.date*`` lines such as ``2025. 07. 05. SAT 8PM / ...``.
The parser keeps only those three facts. Layout changes raise an error so a
refresh never publishes a partial schedule.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser


DATE_PATTERN = re.compile(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.")


class ScheduleParseError(ValueError):
    pass


@dataclass(frozen=True)
class ScheduleEntry:
    city: str
    venue: str
    event_date: str

    @property
    def locator(self) -> str:
        return f"{self.city} > {self.venue} > {self.event_date}"


@dataclass
class _Block:
    city: str
    venue: str = ""
    dates: list[str] | None = None


class _ScheduleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[_Block] = []
        self._field: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "p":
            return
        classes = (dict(attrs).get("class") or "").split()
        if "city" in classes:
            self._field = "city"
        elif "place" in classes:
            self._field = "place"
        elif any(name.startswith("date") for name in classes):
            self._field = "date"
        else:
            return
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._field is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "p" or self._field is None:
            return
        text = " ".join("".join(self._text).split())
        field, self._field = self._field, None
        if field == "city":
            self.blocks.append(_Block(city=text))
            return
        if not self.blocks:
            raise ScheduleParseError(f"{field} line appears before any city")
        block = self.blocks[-1]
        if field == "place":
            block.venue = text
        else:
            block.dates = (block.dates or []) + _parse_dates(text)


def parse_yg_tour_schedule(html: str) -> tuple[ScheduleEntry, ...]:
    """Return one entry per listed date, in page order."""
    parser = _ScheduleParser()
    parser.feed(html)
    parser.close()
    if not parser.blocks:
        raise ScheduleParseError("no destination blocks found")
    entries: list[ScheduleEntry] = []
    for block in parser.blocks:
        if not block.city or not block.venue or not block.dates:
            raise ScheduleParseError(f"incomplete destination block: {block.city or '<no city>'}")
        entries.extend(ScheduleEntry(block.city, block.venue, value) for value in block.dates)
    dates = [entry.event_date for entry in entries]
    duplicates = sorted({value for value in dates if dates.count(value) > 1})
    if duplicates:
        raise ScheduleParseError(f"dates listed more than once: {', '.join(duplicates)}")
    return tuple(entries)


def _parse_dates(text: str) -> list[str]:
    values: list[str] = []
    for year, month, day in DATE_PATTERN.findall(text):
        try:
            values.append(date(int(year), int(month), int(day)).isoformat())
        except ValueError as exc:
            raise ScheduleParseError(f"invalid date in schedule line: {text}") from exc
    if not values:
        raise ScheduleParseError(f"no date found in schedule line: {text}")
    return values
