"""Read YouTube identifiers and subscriber snapshots from Wikidata claims.

Google does not publish a search-volume API. Keyword Planner needs a Google
Ads account, and Google Trends has no supported API. This module does not
estimate search interest. Wikipedia lead extracts in the local catalog also
do not contain YouTube links. Channel IDs come from Wikidata P2397.

Live subscriber and view totals need the YouTube Data API and a key in
``YOUTUBE_API_KEY``. ``channels.list`` costs 1 unit per call and accepts 50
channel IDs. Without a key, the only subscriber figures are the dated
P8687 statements already stored on Wikidata.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from decimal import Decimal
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

YOUTUBE_CHANNEL_PROPERTY = "P2397"
YOUTUBE_HANDLE_PROPERTY = "P11245"
FOLLOWERS_PROPERTY = "P8687"
POINT_IN_TIME_PROPERTY = "P585"
YOUTUBE_STATISTICS_URL = "https://www.googleapis.com/youtube/v3/channels"
CHANNEL_ID = re.compile(r"^UC[-_0-9A-Za-z]{21}[AQgw]$")
HANDLE = re.compile(r"^[0-9A-Za-z._-]{3,30}$")
_TIME = re.compile(r"^\+(\d{4})-(\d{2})-(\d{2})T")
RANK_ORDER = {"preferred": 0, "normal": 1}


class SignalError(ValueError):
    """A Wikidata claim or YouTube statistics payload cannot be used."""


def extract_group_signals(entity: Mapping[str, Any]) -> dict[str, Any]:
    """Return channel IDs, handles, and YouTube subscriber snapshots.

    A P8687 statement counts only when a P2397 qualifier names one of this
    entity's own channel IDs. Follower counts qualified with Twitter or
    another account stay out, and a deprecated statement stays out.
    """
    channels = _external_ids(entity, YOUTUBE_CHANNEL_PROPERTY, CHANNEL_ID)
    handles = _external_ids(entity, YOUTUBE_HANDLE_PROPERTY, HANDLE)
    channel_ids = {channel["id"] for channel in channels}
    snapshots = []
    for statement in _statements(entity, FOLLOWERS_PROPERTY):
        if statement.get("rank") not in RANK_ORDER:
            continue
        count = _quantity(statement.get("mainsnak"))
        statement_id = _statement_id(statement)
        if count is None or statement_id is None:
            continue
        qualified_channels = _qualifier_strings(statement, YOUTUBE_CHANNEL_PROPERTY, CHANNEL_ID)
        matched_channels = sorted(channel_ids & set(qualified_channels))
        matched_handles = _qualifier_strings(statement, YOUTUBE_HANDLE_PROPERTY, HANDLE)
        if matched_channels:
            identity = {"channel_id": matched_channels[0], "handle": None}
        elif matched_handles:
            identity = {"channel_id": None, "handle": matched_handles[0]}
        else:
            continue
        snapshots.append(
            {
                **identity,
                "count": count,
                "point_in_time": _point_in_time(statement),
                "rank": statement.get("rank"),
                "property_id": FOLLOWERS_PROPERTY,
                "statement_id": statement_id,
                "locator": f"claims/{FOLLOWERS_PROPERTY}/{statement_id}",
            }
        )
    return {"channels": channels, "handles": handles, "subscriber_snapshots": snapshots}


def select_rankable_signals(groups: list[dict[str, Any]]) -> None:
    """Choose one subscriber total per group and reject channels used twice.

    The choice prefers the latest snapshot on a preferred channel that no
    other group also claims. A shared channel stays in the row for inspection,
    with ``usable_for_rank`` false, because the subscriber total belongs to
    the channel rather than to each group.
    """
    channel_owners: dict[str, set[str]] = {}
    handle_owners: dict[str, set[str]] = {}
    for group in groups:
        qid = group["wikidata_id"]
        for channel in group["channels"]:
            channel_owners.setdefault(channel["id"], set()).add(qid)
        for handle in group.get("handles", ()):
            handle_owners.setdefault(handle["id"], set()).add(qid)
        for snapshot in group["subscriber_snapshots"]:
            if snapshot.get("handle"):
                handle_owners.setdefault(snapshot["handle"], set()).add(qid)
    shared_channels = {channel_id for channel_id, used_by in channel_owners.items() if len(used_by) > 1}
    shared_handles = {handle for handle, used_by in handle_owners.items() if len(used_by) > 1}
    for group in groups:
        for channel in group["channels"]:
            channel["shared"] = channel["id"] in shared_channels
        for snapshot in group["subscriber_snapshots"]:
            snapshot["shared"] = bool(
                (snapshot.get("channel_id") and snapshot["channel_id"] in shared_channels)
                or (snapshot.get("handle") and snapshot["handle"] in shared_handles)
            )
        chosen = _choose_snapshot(group["channels"], group["subscriber_snapshots"])
        group["selected_channel_id"] = chosen["channel_id"] if chosen else None
        group["selected_handle"] = chosen.get("handle") if chosen else None
        group["selected_subscribers"] = chosen["count"] if chosen else None
        group["selected_as_of"] = chosen["point_in_time"] if chosen else None
        group["usable_for_rank"] = bool(chosen) and not chosen.get("shared")


def fetch_youtube_statistics(
    channel_ids: list[str],
    api_key: str,
    timeout: float = 30,
) -> dict[str, dict[str, int | bool | None]]:
    """Fetch live ``statistics`` for up to 50 channel IDs."""
    if not api_key.strip():
        raise SignalError("YouTube API key is empty")
    if not channel_ids or len(channel_ids) > 50:
        raise SignalError("YouTube statistics accepts 1 to 50 channel IDs")
    if any(CHANNEL_ID.fullmatch(channel_id) is None for channel_id in channel_ids):
        raise SignalError("YouTube statistics received a channel ID that is not a UC id")
    url = YOUTUBE_STATISTICS_URL + "?" + urlencode(
        {"part": "statistics", "id": ",".join(channel_ids), "key": api_key}
    )
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "kpop-quiz-group-signals/1.0"})
    request_failed = False
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        request_failed = True
    if request_failed:
        raise SignalError("YouTube statistics request failed")
    parsed = parse_youtube_statistics(payload)
    unexpected = sorted(set(parsed) - set(channel_ids))
    if unexpected:
        raise SignalError(f"YouTube statistics returned unexpected channel IDs: {unexpected!r}")
    return parsed


def parse_youtube_statistics(payload: object) -> dict[str, dict[str, int | bool | None]]:
    """Read subscriber, view, and video counts from a ``channels.list`` body."""
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise SignalError("YouTube statistics response has no items list")
    parsed: dict[str, dict[str, int | bool | None]] = {}
    for item in payload["items"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise SignalError("YouTube statistics item has no channel ID")
        statistics = item.get("statistics")
        if not isinstance(statistics, dict):
            raise SignalError(f"YouTube channel {item['id']} has no statistics")
        hidden = statistics.get("hiddenSubscriberCount", False)
        if type(hidden) is not bool:
            raise SignalError(f"YouTube channel {item['id']} has invalid hiddenSubscriberCount")
        subscriber_count = None if hidden else _api_count(
            statistics, "subscriberCount", item["id"]
        )
        parsed[item["id"]] = {
            "subscriber_count": subscriber_count,
            "hidden_subscriber_count": hidden,
            "view_count": _api_count(statistics, "viewCount", item["id"]),
            "video_count": _api_count(statistics, "videoCount", item["id"]),
        }
    return parsed


def _choose_snapshot(
    channels: list[dict[str, Any]], snapshots: list[dict[str, Any]]
) -> dict[str, Any] | None:
    private = [channel["id"] for channel in channels if not channel.get("shared")]
    preferred = [
        channel["id"]
        for channel in channels
        if not channel.get("shared") and channel["rank"] == "preferred"
    ]
    every = [channel["id"] for channel in channels]
    pools = [
        [snapshot for snapshot in snapshots if snapshot.get("channel_id") in preferred],
        [snapshot for snapshot in snapshots if snapshot.get("channel_id") in private],
        [snapshot for snapshot in snapshots if snapshot.get("channel_id") in every],
        [snapshot for snapshot in snapshots if snapshot.get("handle") and not snapshot.get("shared")],
        [snapshot for snapshot in snapshots if snapshot.get("handle")],
    ]
    for matched in pools:
        if matched:
            return max(matched, key=_snapshot_sort_key)
    return None


def _snapshot_sort_key(snapshot: Mapping[str, Any]) -> tuple[str, int, int]:
    return (
        str(snapshot["point_in_time"] or ""),
        -RANK_ORDER.get(str(snapshot["rank"]), 9),
        int(snapshot["count"]),
    )


def _external_ids(entity: Mapping[str, Any], property_id: str, pattern: re.Pattern[str]) -> list[dict[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for statement in _statements(entity, property_id):
        rank = statement.get("rank")
        value = _string(statement.get("mainsnak"))
        statement_id = _statement_id(statement)
        if (
            rank not in RANK_ORDER
            or value is None
            or pattern.fullmatch(value) is None
            or statement_id is None
        ):
            continue
        previous = found.get(value)
        if previous is None or RANK_ORDER[str(rank)] < RANK_ORDER[previous[0]]:
            found[value] = (str(rank), statement_id)
    return [
        {
            "id": value,
            "rank": rank,
            "property_id": property_id,
            "statement_id": statement_id,
            "locator": f"claims/{property_id}/{statement_id}",
        }
        for value, (rank, statement_id) in sorted(found.items())
    ]


def _statement_id(statement: Mapping[str, Any]) -> str | None:
    statement_id = statement.get("id")
    if not isinstance(statement_id, str):
        return None
    stripped = statement_id.strip()
    return stripped or None


def _statements(entity: Mapping[str, Any], property_id: str) -> list[Mapping[str, Any]]:
    claims = entity.get("claims")
    raw = claims.get(property_id) if isinstance(claims, Mapping) else None
    if not isinstance(raw, list):
        return []
    return [statement for statement in raw if isinstance(statement, Mapping)]


def _qualifier_strings(
    statement: Mapping[str, Any], property_id: str, pattern: re.Pattern[str]
) -> list[str]:
    qualifiers = statement.get("qualifiers")
    raw = qualifiers.get(property_id) if isinstance(qualifiers, Mapping) else None
    if not isinstance(raw, list):
        return []
    return [
        value
        for snak in raw
        if isinstance((value := _string(snak)), str) and pattern.fullmatch(value)
    ]


def _point_in_time(statement: Mapping[str, Any]) -> str | None:
    qualifiers = statement.get("qualifiers")
    raw = qualifiers.get(POINT_IN_TIME_PROPERTY) if isinstance(qualifiers, Mapping) else None
    if not isinstance(raw, list):
        return None
    dates = [date for snak in raw if isinstance((date := _time(snak)), str)]
    return max(dates) if dates else None


def _string(snak: object) -> str | None:
    value = _datavalue(snak)
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _quantity(snak: object) -> int | None:
    value = _datavalue(snak)
    amount = value.get("amount") if isinstance(value, Mapping) else None
    if not isinstance(amount, str):
        return None
    try:
        number = Decimal(amount)
    except ArithmeticError:
        return None
    if number != number.to_integral_value() or number < 0:
        return None
    return int(number)


def _time(snak: object) -> str | None:
    value = _datavalue(snak)
    raw = value.get("time") if isinstance(value, Mapping) else None
    precision = value.get("precision") if isinstance(value, Mapping) else None
    if not isinstance(raw, str) or not isinstance(precision, int):
        return None
    match = _TIME.match(raw)
    if match is None or precision < 9:
        return None
    year, month, day = match.groups()
    if precision >= 11:
        return f"{year}-{month}-{day}"
    if precision == 10:
        return f"{year}-{month}"
    return year


def _datavalue(snak: object) -> object:
    if not isinstance(snak, Mapping) or snak.get("snaktype") != "value":
        return None
    datavalue = snak.get("datavalue")
    return datavalue.get("value") if isinstance(datavalue, Mapping) else None


def _api_count(statistics: Mapping[str, Any], field: str, channel_id: str) -> int:
    raw = statistics.get(field)
    if isinstance(raw, str) and raw.isdecimal():
        return int(raw)
    raise SignalError(f"YouTube channel {channel_id} has no integer {field}")
