"""Rebuild the map-pilot tour dataset from its sources.

Collection, extraction and validation are separate steps:

1. ``collect_*`` functions perform sequential network requests.
2. ``build_map_pilot_dataset`` joins the official schedule, MusicBrainz and
   Wikidata snapshots without I/O.
3. ``validate_map_pilot_dataset`` checks a dataset file offline.

An event enters the dataset only when every check passes:

- the official schedule lists its date, and the city label on the schedule
  matches the MusicBrainz event or one of its areas;
- MusicBrainz records a concert that is not cancelled, on a single complete
  date, with the reviewed artist as main performer at exactly one venue;
- the venue's MusicBrainz area hierarchy reaches exactly one country;
- the current Wikidata country (P17) of that area includes the same country;
- the country QID resolves to exactly one Natural Earth map feature.

Dates on the schedule without a matching MusicBrainz event are listed in
``unmatched_schedule_dates``; a later refresh picks them up once MusicBrainz
records them.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from .country_crosswalk import build_country_crosswalk
from .musicbrainz import DEFAULT_USER_AGENT, MusicBrainzClient
from .official_schedule import ScheduleEntry, parse_yg_tour_schedule
from .tour_events import CountryIdentity, TourEventContext, assess_tour_event_candidate
from .wikidata import MAX_ENTITIES_PER_REQUEST, EntityProfile, WikidataEntityClient


SCHEMA_VERSION = "kpop-map-pilot-events-v2"
MAP_DATASET = "Natural Earth Admin 0 - Countries"
MAP_DATASET_VERSION = "5.1.1"
MAP_SCALE = "1:10m"
DEFAULT_OUTPUT = Path("data/map-pilot/deadline-events.json")
DEFAULT_MAP = Path("web/src/data/map-pilot/world-map.json")
# The monthly job can wait out replication lag: 8 retries back off for up to
# 255 s in total, while the default 3 give up after 7 s.
WIKIDATA_RETRIES = 8


@dataclass(frozen=True)
class PilotConfig:
    name: str
    subject_wikidata_id: str
    artist_mbid: str
    series_mbid: str
    schedule_url: str

    @property
    def schedule_host(self) -> str:
        return self.schedule_url.split("/")[2]


DEADLINE_TOUR = PilotConfig(
    name="BLACKPINK DEADLINE WORLD TOUR",
    subject_wikidata_id="Q25056945",
    artist_mbid="48646387-1664-4c9a-9139-9bfd091b823c",
    series_mbid="510f1af4-7a2e-40f2-abd4-776d8da29b94",
    schedule_url="https://artist.ygfamily.com/ARTISTS/BLACKPINK/concert/2025TOUR/index2.html",
)


@dataclass
class MusicBrainzSnapshot:
    series: dict[str, Any]
    artist: dict[str, Any]
    events: dict[str, dict[str, Any]] = field(default_factory=dict)
    places: dict[str, dict[str, Any]] = field(default_factory=dict)
    areas: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class AreaCountryClaim:
    revision_id: int
    country_ids: frozenset[str]


class DatasetError(ValueError):
    pass


# Collection -----------------------------------------------------------------


def fetch_schedule_html(url: str, user_agent: str = DEFAULT_USER_AGENT, timeout: float = 30) -> str:
    request = Request(url, headers={"Accept": "text/html", "User-Agent": user_agent})
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset)


def collect_musicbrainz(client: MusicBrainzClient, config: PilotConfig) -> MusicBrainzSnapshot:
    snapshot = MusicBrainzSnapshot(
        series=client.lookup("series", config.series_mbid, ("event-rels",)),
        artist=client.lookup("artist", config.artist_mbid, ("url-rels",)),
    )
    for relation in snapshot.series.get("relations", []):
        if relation.get("target-type") != "event":
            continue
        event_id = relation["event"]["id"]
        event = client.lookup("event", event_id, ("artist-rels", "place-rels"))
        snapshot.events[event_id] = event
        for place_id in _related_ids(event, "place", "held at"):
            if place_id in snapshot.places:
                continue
            place = client.lookup("place", place_id, ("area-rels", "url-rels"))
            snapshot.places[place_id] = place
            area_id = (place.get("area") or {}).get("id")
            while area_id and area_id not in snapshot.areas:
                area = client.lookup("area", area_id, ("area-rels", "url-rels"))
                snapshot.areas[area_id] = area
                area_id = _parent_area_id(area)
    return snapshot


AREA_COUNTRY_PROFILE = EntityProfile(name="area-country-v1", props="info|claims", languages="en")


def collect_area_countries(
    client: WikidataEntityClient, wikidata_ids: Iterable[str]
) -> dict[str, AreaCountryClaim]:
    ids = sorted(set(wikidata_ids))
    claims: dict[str, AreaCountryClaim] = {}
    for start in range(0, len(ids), MAX_ENTITIES_PER_REQUEST):
        batch = client.get_entities(ids[start : start + MAX_ENTITIES_PER_REQUEST], AREA_COUNTRY_PROFILE)
        for document in batch.documents:
            claims[document.requested_id] = AreaCountryClaim(
                revision_id=document.revision_id,
                country_ids=current_item_values(document.payload, "P17"),
            )
    return claims


# Extraction and joins -------------------------------------------------------


def current_item_values(entity: Mapping[str, Any], property_id: str) -> frozenset[str]:
    """Return item values of the best current rank, skipping ended statements."""
    statements = [
        statement
        for statement in (entity.get("claims") or {}).get(property_id, [])
        if statement.get("rank") != "deprecated" and "P582" not in (statement.get("qualifiers") or {})
    ]
    preferred = [statement for statement in statements if statement.get("rank") == "preferred"]
    values = set()
    for statement in preferred or statements:
        value = ((statement.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            values.add(value["id"])
    return frozenset(values)


def wikidata_ids(entity: Mapping[str, Any]) -> list[str]:
    prefix = "https://www.wikidata.org/wiki/"
    return sorted(
        {
            relation["url"]["resource"][len(prefix) :]
            for relation in entity.get("relations", [])
            if relation.get("target-type") == "url"
            and relation.get("type") == "wikidata"
            and str(relation["url"].get("resource", "")).startswith(prefix)
        }
    )


def area_chain(snapshot: MusicBrainzSnapshot, area_id: str | None) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    while area_id and area_id in snapshot.areas and area_id not in seen:
        seen.add(area_id)
        area = snapshot.areas[area_id]
        chain.append(area)
        area_id = _parent_area_id(area)
    return chain


def area_wikidata_ids(snapshot: MusicBrainzSnapshot) -> set[str]:
    """QIDs of the areas that directly contain each venue."""
    ids: set[str] = set()
    for place in snapshot.places.values():
        area = snapshot.areas.get((place.get("area") or {}).get("id", ""))
        if area:
            ids.update(wikidata_ids(area))
    return ids


def build_map_pilot_dataset(
    config: PilotConfig,
    schedule: Sequence[ScheduleEntry],
    snapshot: MusicBrainzSnapshot,
    area_countries: Mapping[str, AreaCountryClaim],
    world_map: Mapping[str, Any],
    checked_at: str,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Return the dataset and the events excluded with their reasons."""
    schedule_by_date = {entry.event_date: entry for entry in schedule}
    reviewed_artists = frozenset([config.artist_mbid]) if config.subject_wikidata_id in wikidata_ids(snapshot.artist) else frozenset()

    rows: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    matched_dates: set[str] = set()
    for event_id, event in snapshot.events.items():
        row, reason = _event_row(config, event_id, event, schedule_by_date, snapshot, area_countries, checked_at)
        if row is None:
            excluded.append({"event_mbid": event_id, "reason": reason})
            continue
        rows.append(row)

    countries = sorted(
        {(row["country_wikidata_id"], row["country_iso_3166_1"]) for row in rows}
    )
    crosswalk = build_country_crosswalk(
        _feature_collection(world_map),
        [{"wikidata_id": qid, "iso_3166_1": iso} for qid, iso in countries],
        dataset_version=MAP_DATASET_VERSION,
        scale=MAP_SCALE,
    )
    features = {row["wikidata_id"]: row["map_feature_id"] for row in crosswalk["matched_countries"]}

    events: list[dict[str, Any]] = []
    context = TourEventContext(
        approved_source_hosts=frozenset([config.schedule_host]),
        reviewed_group_artists={config.subject_wikidata_id: reviewed_artists},
        reviewed_event_artists={row["event_mbid"]: frozenset([config.artist_mbid]) for row in rows},
        place_city_relations={row["place_mbid"]: frozenset([row["city_area_mbid"]]) for row in rows},
        city_countries={
            row["city_area_mbid"]: (CountryIdentity(row["country_wikidata_id"], row["country_iso_3166_1"]),)
            for row in rows
        },
    )
    for row in rows:
        feature_id = features.get(row["country_wikidata_id"])
        if feature_id is None:
            excluded.append({"event_mbid": row["event_mbid"], "reason": "map_feature_unresolved"})
            continue
        assessment = assess_tour_event_candidate(
            {key: row[key] for key in _VALIDATOR_FIELDS}, context
        )
        if not assessment.ready_for_editor_review:
            excluded.append({"event_mbid": row["event_mbid"], "reason": ",".join(assessment.issues)})
            continue
        matched_dates.add(row["event_date"])
        events.append(
            {
                **row,
                "map_feature_id": feature_id,
                "map_dataset": MAP_DATASET,
                "map_dataset_version": MAP_DATASET_VERSION,
                "map_scale": MAP_SCALE,
                "status": "accepted",
            }
        )

    events.sort(key=lambda row: (row["event_date"], row["event_mbid"]))
    used_features = {row["map_feature_id"] for row in events}
    dataset = {
        "schema_version": SCHEMA_VERSION,
        "pilot": config.name,
        "reference_date": checked_at,
        "question_semantics": (
            "country whose territory contains the venue of a date listed in the official "
            "schedule on source_checked_at; not a claim that the show took place"
        ),
        "sources": {
            "official_schedule": config.schedule_url,
            "musicbrainz_series_url": f"https://musicbrainz.org/series/{config.series_mbid}",
            "musicbrainz_license": "CC0 core data",
            "wikidata_license": "CC0",
        },
        "country_crosswalk_id": crosswalk["crosswalk_id"],
        "countries": [row for row in crosswalk["matched_countries"] if row["map_feature_id"] in used_features],
        "events": events,
        "unmatched_schedule_dates": [
            {
                "event_date": entry.event_date,
                "official_destination": entry.city,
                "reason": "no accepted MusicBrainz event on this date",
            }
            for entry in schedule
            if entry.event_date not in matched_dates
        ],
    }
    validate_map_pilot_dataset(dataset, world_map)
    return dataset, sorted(excluded, key=lambda row: row["event_mbid"])


_VALIDATOR_FIELDS = (
    "source_url",
    "subject_wikidata_id",
    "artist_musicbrainz_mbid",
    "event_mbid",
    "event_date",
    "event_type",
    "billing_role",
    "place_mbid",
    "city_area_mbid",
    "country_wikidata_id",
    "country_iso_3166_1",
    "schedule_status",
    "source_locator",
    "source_checked_at",
    "tour_mbid",
)


def _event_row(
    config: PilotConfig,
    event_id: str,
    event: Mapping[str, Any],
    schedule_by_date: Mapping[str, ScheduleEntry],
    snapshot: MusicBrainzSnapshot,
    area_countries: Mapping[str, AreaCountryClaim],
    checked_at: str,
) -> tuple[dict[str, Any] | None, str]:
    if event.get("type") != "Concert":
        return None, "not_a_concert"
    if event.get("cancelled"):
        return None, "event_cancelled"
    life_span = event.get("life-span") or {}
    event_date = life_span.get("begin")
    if not isinstance(event_date, str) or len(event_date) != 10 or life_span.get("end") != event_date:
        return None, "date_not_single_day"
    entry = schedule_by_date.get(event_date)
    if entry is None:
        return None, "date_not_in_official_schedule"

    main_performers = _related_ids(event, "artist", "main performer")
    if config.artist_mbid not in main_performers:
        return None, "artist_not_main_performer"
    places = _related_ids(event, "place", "held at")
    if len(places) != 1 or places[0] not in snapshot.places:
        return None, "venue_missing_or_ambiguous"
    place = snapshot.places[places[0]]
    chain = area_chain(snapshot, (place.get("area") or {}).get("id"))
    if not chain:
        return None, "venue_area_missing"

    city_labels = {_label(area["name"]) for area in chain}
    city_labels.add(_label(str(event.get("name", "")).rsplit(":", 1)[-1]))
    if _label(entry.city) not in city_labels:
        return None, "city_differs_from_official_schedule"

    country = chain[-1]
    country_codes = country.get("iso-3166-1-codes") or []
    country_ids = wikidata_ids(country)
    if country.get("type") != "Country" or len(country_codes) != 1 or len(country_ids) != 1:
        return None, "country_unresolved"
    area_ids = wikidata_ids(chain[0])
    if len(area_ids) != 1 or area_ids[0] not in area_countries:
        return None, "area_wikidata_missing"
    area_claim = area_countries[area_ids[0]]
    if country_ids[0] not in area_claim.country_ids:
        return None, "country_conflicts_with_wikidata"

    return (
        {
            "subject_wikidata_id": config.subject_wikidata_id,
            "predicate": "announced_performance_city",
            "artist_musicbrainz_mbid": config.artist_mbid,
            "event_mbid": event_id,
            "event_date": event_date,
            "event_type": "concert",
            "schedule_status": "listed",
            "billing_role": "headliner" if len(main_performers) == 1 else "co_headliner",
            "tour_mbid": config.series_mbid,
            "place_mbid": places[0],
            "city_area_mbid": chain[0]["id"],
            "city_area_type": chain[0].get("type") or "",
            "country_wikidata_id": country_ids[0],
            "country_iso_3166_1": country_codes[0],
            "country_check_wikidata_id": area_ids[0],
            "country_check_wikidata_revid": area_claim.revision_id,
            "source_url": config.schedule_url,
            "source_locator": entry.locator,
            "source_checked_at": checked_at,
            "musicbrainz_event_url": f"https://musicbrainz.org/event/{event_id}",
        },
        "",
    )


def _related_ids(entity: Mapping[str, Any], target_type: str, relation_type: str) -> list[str]:
    return [
        relation[target_type]["id"]
        for relation in entity.get("relations", [])
        if relation.get("target-type") == target_type and relation.get("type") == relation_type
    ]


def _parent_area_id(area: Mapping[str, Any]) -> str | None:
    if area.get("type") == "Country":
        return None
    parents = [
        relation["area"]["id"]
        for relation in area.get("relations", [])
        if relation.get("target-type") == "area"
        and relation.get("type") == "part of"
        and relation.get("direction") == "backward"
    ]
    return parents[0] if len(parents) == 1 else None


def _label(value: str) -> str:
    return " ".join(value.casefold().split())


def _feature_collection(world_map: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "ADM0_A3": feature.get("id"),
                    "WIKIDATAID": feature.get("wikidata_id"),
                    "ISO_A2": feature.get("iso_a2"),
                },
            }
            for feature in world_map.get("features", [])
        ],
    }


# Validation -----------------------------------------------------------------


_EVENT_FIELDS = frozenset(
    {*_VALIDATOR_FIELDS, "predicate", "city_area_type", "country_check_wikidata_id",
     "country_check_wikidata_revid", "musicbrainz_event_url", "map_feature_id", "map_dataset",
     "map_dataset_version", "map_scale", "status"}
)


def validate_map_pilot_dataset(dataset: Mapping[str, Any], world_map: Mapping[str, Any]) -> None:
    """Check a dataset offline. Raise ``DatasetError`` on the first problem."""
    _check(dataset.get("schema_version") == SCHEMA_VERSION, "unsupported schema_version")
    events = dataset.get("events")
    _check(isinstance(events, list) and events, "events must be a non-empty list")
    features = {feature["id"]: feature for feature in world_map.get("features", [])}
    countries = {row["map_feature_id"]: row for row in dataset.get("countries", [])}
    for feature_id, country in countries.items():
        feature = features.get(feature_id)
        _check(feature is not None, f"map feature missing: {feature_id}")
        _check(feature.get("wikidata_id") == country["wikidata_id"], f"country QID differs from map feature: {feature_id}")

    seen_events: set[str] = set()
    seen_dates: set[str] = set()
    for event in events:
        event_id = event.get("event_mbid")
        _check(set(event) == _EVENT_FIELDS, f"unexpected event fields: {event_id}")
        _check(event_id not in seen_events, f"duplicate event_mbid: {event_id}")
        _check(event["event_date"] not in seen_dates, f"duplicate event_date: {event['event_date']}")
        seen_events.add(event_id)
        seen_dates.add(event["event_date"])
        _check(event["status"] == "accepted", f"event not accepted: {event_id}")
        country = countries.get(event["map_feature_id"])
        _check(country is not None, f"event country missing from countries: {event_id}")
        _check(
            country["wikidata_id"] == event["country_wikidata_id"]
            and country["iso_3166_1"] == event["country_iso_3166_1"],
            f"event country differs from crosswalk: {event_id}",
        )
        _check(event["source_locator"].endswith(f"> {event['event_date']}"), f"locator date differs: {event_id}")
        context = TourEventContext(
            approved_source_hosts=frozenset([event["source_url"].split("/")[2]]),
            reviewed_group_artists={event["subject_wikidata_id"]: frozenset([event["artist_musicbrainz_mbid"]])},
            reviewed_event_artists={event_id: frozenset([event["artist_musicbrainz_mbid"]])},
            place_city_relations={event["place_mbid"]: frozenset([event["city_area_mbid"]])},
            city_countries={
                event["city_area_mbid"]: (CountryIdentity(event["country_wikidata_id"], event["country_iso_3166_1"]),)
            },
        )
        assessment = assess_tour_event_candidate({key: event[key] for key in _VALIDATOR_FIELDS}, context)
        _check(assessment.ready_for_editor_review, f"{event_id}: {','.join(assessment.issues)}")
    for row in dataset.get("unmatched_schedule_dates", []):
        _check(row["event_date"] not in seen_dates, f"unmatched date also has an event: {row['event_date']}")


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise DatasetError(message)


# CLI --------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--map", type=Path, default=DEFAULT_MAP)
    parser.add_argument("--checked-at", help="YYYY-MM-DD; defaults to the current UTC date")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    args = parser.parse_args(argv)

    checked_at = args.checked_at or datetime.now(timezone.utc).date().isoformat()
    world_map = json.loads(args.map.read_text(encoding="utf-8"))
    config = DEADLINE_TOUR

    schedule = parse_yg_tour_schedule(fetch_schedule_html(config.schedule_url, args.user_agent))
    snapshot = collect_musicbrainz(MusicBrainzClient(user_agent=args.user_agent), config)
    area_countries = collect_area_countries(
        WikidataEntityClient(user_agent=args.user_agent, retries=WIKIDATA_RETRIES), area_wikidata_ids(snapshot)
    )
    dataset, excluded = build_map_pilot_dataset(
        config, schedule, snapshot, area_countries, world_map, checked_at
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Schedule dates: {len(schedule)}; MusicBrainz events: {len(snapshot.events)}; "
        f"accepted: {len(dataset['events'])}; countries: {len(dataset['countries'])}"
    )
    for row in dataset["unmatched_schedule_dates"]:
        print(f"unmatched schedule date: {row['event_date']} {row['official_destination']}")
    for row in excluded:
        print(f"excluded event {row['event_mbid']}: {row['reason']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
