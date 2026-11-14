from __future__ import annotations

import copy
import io
import json
import re
from pathlib import Path
import unittest
from unittest import mock
from urllib.error import HTTPError

from kpop_scraping.map_pilot_refresh import (
    DEADLINE_TOUR,
    MAX_AREA_DEPTH,
    MAX_SERIES_EVENTS,
    WIKIDATA_MAXLAG_BUDGET_SECONDS,
    AreaCountryClaim,
    DatasetError,
    MusicBrainzSnapshot,
    area_wikidata_ids,
    build_map_pilot_dataset,
    collect_musicbrainz,
    current_item_values,
    validate_map_pilot_dataset,
)
from kpop_scraping.musicbrainz import MusicBrainzClient, MusicBrainzError
from kpop_scraping.official_schedule import ScheduleEntry, ScheduleParseError, parse_yg_tour_schedule

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "fixtures" / "musicbrainz_deadline_sample.json"
WORLD_MAP = ROOT / "web" / "src" / "data" / "map-pilot" / "world-map.json"
DATASET = ROOT / "data" / "map-pilot" / "deadline-events.json"

SCHEDULE_HTML = """
<div id="info">
  <div id="toronto" class="toronto info buy">
    <div class="nation"><p class="city">TORONTO</p><p class="place">ROGERS STADIUM</p></div>
    <div class="date"><p class="date1">2025. 07. 22. TUE 8PM / 2025. 07. 23. WED 8PM</p></div>
  </div>
  <div id="kaohsiung" class="kaohsiung info buy">
    <div class="nation"><p class="city">KAOHSIUNG</p><p class="place">KAOHSIUNG NATIONAL STADIUM</p></div>
    <div class="date"><p class="date1">2025. 10. 18. SAT 6:30PM</p></div>
  </div>
  <div id="hongkong" class="hongkong info buy">
    <div class="nation"><p class="city">HONG KONG</p><p class="place">KAI TAK STADIUM</p></div>
    <div class="date"><p class="date1">2026. 01. 24. SAT 6:30PM</p></div>
  </div>
</div>
"""

AREA_COUNTRIES = {
    "Q1586510": AreaCountryClaim(1, frozenset({"Q16"})),
    "Q181557": AreaCountryClaim(2, frozenset({"Q865"})),
    "Q986415": AreaCountryClaim(3, frozenset({"Q148"})),
}


def load_snapshot() -> MusicBrainzSnapshot:
    return MusicBrainzSnapshot(**json.loads(FIXTURE.read_text(encoding="utf-8")))


def load_world_map() -> dict:
    return json.loads(WORLD_MAP.read_text(encoding="utf-8"))


def build(snapshot=None, area_countries=None, html=SCHEDULE_HTML):
    return build_map_pilot_dataset(
        DEADLINE_TOUR,
        parse_yg_tour_schedule(html),
        snapshot or load_snapshot(),
        AREA_COUNTRIES if area_countries is None else area_countries,
        load_world_map(),
        "2026-09-25",
    )


def event_id_on(snapshot: MusicBrainzSnapshot, event_date: str) -> str:
    return next(key for key, event in snapshot.events.items() if event["life-span"]["begin"] == event_date)


class OfficialScheduleTest(unittest.TestCase):
    def test_reads_one_entry_per_listed_date(self):
        entries = parse_yg_tour_schedule(SCHEDULE_HTML)
        self.assertEqual(
            [entry.event_date for entry in entries],
            ["2025-07-22", "2025-07-23", "2025-10-18", "2026-01-24"],
        )
        self.assertEqual(entries[0], ScheduleEntry("TORONTO", "ROGERS STADIUM", "2025-07-22"))
        self.assertEqual(entries[0].locator, "TORONTO > ROGERS STADIUM > 2025-07-22")

    def test_rejects_layout_without_destinations(self):
        with self.assertRaisesRegex(ScheduleParseError, "no destination"):
            parse_yg_tour_schedule("<div><p>SCHEDULE</p></div>")

    def test_rejects_block_without_dates(self):
        html = '<p class="city">PARIS</p><p class="place">STADE DE FRANCE</p><p class="date1">TBA</p>'
        with self.assertRaisesRegex(ScheduleParseError, "no date found"):
            parse_yg_tour_schedule(html)

    def test_rejects_invalid_calendar_date(self):
        html = '<p class="city">PARIS</p><p class="place">STADE</p><p class="date1">2025. 02. 30. SUN</p>'
        with self.assertRaisesRegex(ScheduleParseError, "invalid date"):
            parse_yg_tour_schedule(html)

    def test_rejects_date_listed_twice(self):
        html = SCHEDULE_HTML.replace("2025. 10. 18.", "2025. 07. 22.")
        with self.assertRaisesRegex(ScheduleParseError, "more than once"):
            parse_yg_tour_schedule(html)


class MusicBrainzClientTest(unittest.TestCase):
    def make_client(self):
        self.now = 100.0
        self.sleeps: list[float] = []

        def sleep(seconds: float) -> None:
            self.sleeps.append(seconds)
            self.now += seconds

        return MusicBrainzClient(clock=lambda: self.now, sleep=sleep)

    def test_spaces_requests_and_identifies_itself(self):
        client = self.make_client()
        requests = []

        def fake_urlopen(request, timeout):
            requests.append((request, timeout))
            return io.BytesIO(b'{"id": "x"}')

        with mock.patch("kpop_scraping.http_request.urlopen", fake_urlopen):
            client.lookup("event", "x", ("artist-rels", "place-rels"))
            client.lookup("place", "y")

        self.assertEqual(self.sleeps, [1.1])
        self.assertEqual(requests[0][1], 30)
        self.assertIn("kpop-quiz", requests[0][0].get_header("User-agent"))
        self.assertTrue(requests[0][0].full_url.endswith("/event/x?fmt=json&inc=artist-rels+place-rels"))

    def test_retries_rate_limit_response(self):
        client = self.make_client()
        responses = [
            HTTPError("https://musicbrainz.org", 503, "busy", {}, io.BytesIO()),
            io.BytesIO(b'{"id": "x"}'),
        ]

        def fake_urlopen(request, timeout):
            response = responses.pop(0)
            if isinstance(response, HTTPError):
                raise response
            return response

        with mock.patch("kpop_scraping.http_request.urlopen", fake_urlopen):
            self.assertEqual(client.lookup("event", "x"), {"id": "x"})
        # Backoff first, then whatever keeps the retry 1.1 s after the first call.
        self.assertEqual(self.sleeps[0], 1.0)
        self.assertAlmostEqual(sum(self.sleeps), 1.1)

    def test_does_not_retry_missing_entity(self):
        client = self.make_client()

        def fake_urlopen(request, timeout):
            raise HTTPError("https://musicbrainz.org", 404, "missing", {}, io.BytesIO())

        with mock.patch("kpop_scraping.http_request.urlopen", fake_urlopen):
            with self.assertRaisesRegex(MusicBrainzError, "HTTP 404"):
                client.lookup("event", "x")

    def test_rejects_unknown_entity(self):
        with self.assertRaises(ValueError):
            self.make_client().lookup("recording", "x")


class FakeMusicBrainz:
    """Answers lookups from a table and records them."""

    def __init__(self, entities: dict[tuple[str, str], dict]) -> None:
        self.entities = entities
        self.lookups: list[tuple[str, str]] = []

    def lookup(self, entity: str, mbid: str, includes: tuple[str, ...] = ()) -> dict:
        self.lookups.append((entity, mbid))
        return self.entities[(entity, mbid)]


def series_of(event_count: int) -> dict:
    return {"relations": [
        {"target-type": "event", "event": {"id": f"event-{index}"}} for index in range(event_count)
    ]}


def event_at(place_id: str) -> dict:
    return {"relations": [{"target-type": "place", "type": "held at", "place": {"id": place_id}}]}


def area_under(parent_id: str | None) -> dict:
    relations = [] if parent_id is None else [
        {"target-type": "area", "type": "part of", "direction": "backward", "area": {"id": parent_id}}
    ]
    return {"type": "City", "relations": relations}


class CollectMusicBrainzLimitTest(unittest.TestCase):
    def entities(self, event_count: int, area_chain: int = 2) -> dict[tuple[str, str], dict]:
        entities = {
            ("series", DEADLINE_TOUR.series_mbid): series_of(event_count),
            ("artist", DEADLINE_TOUR.artist_mbid): {"relations": []},
            ("place", "place-0"): {"area": {"id": "area-0"}},
        }
        for index in range(event_count):
            entities[("event", f"event-{index}")] = event_at("place-0")
        for level in range(area_chain):
            parent = f"area-{level + 1}" if level + 1 < area_chain else None
            entities[("area", f"area-{level}")] = area_under(parent)
        return entities

    def test_a_series_at_the_limit_is_collected(self):
        client = FakeMusicBrainz(self.entities(MAX_SERIES_EVENTS))

        snapshot = collect_musicbrainz(client, DEADLINE_TOUR)

        self.assertEqual(len(snapshot.events), MAX_SERIES_EVENTS)
        self.assertEqual(sorted(snapshot.areas), ["area-0", "area-1"])

    def test_a_series_above_the_limit_fails_before_any_event_lookup(self):
        client = FakeMusicBrainz(self.entities(MAX_SERIES_EVENTS + 1))

        with self.assertRaisesRegex(
            MusicBrainzError, f"lists {MAX_SERIES_EVENTS + 1} events, above the limit of {MAX_SERIES_EVENTS}"
        ):
            collect_musicbrainz(client, DEADLINE_TOUR)
        self.assertEqual([entity for entity, _ in client.lookups], ["series", "artist"])

    def test_relations_other_than_events_do_not_count(self):
        entities = self.entities(1)
        entities[("series", DEADLINE_TOUR.series_mbid)]["relations"].extend(
            {"target-type": "url", "url": {"id": f"url-{index}"}} for index in range(MAX_SERIES_EVENTS + 1)
        )

        self.assertEqual(len(collect_musicbrainz(FakeMusicBrainz(entities), DEADLINE_TOUR).events), 1)

    def test_an_area_chain_deeper_than_the_limit_fails(self):
        self.assertEqual(
            len(collect_musicbrainz(FakeMusicBrainz(self.entities(1, MAX_AREA_DEPTH)), DEADLINE_TOUR).areas),
            MAX_AREA_DEPTH,
        )
        client = FakeMusicBrainz(self.entities(1, MAX_AREA_DEPTH + 1))

        with self.assertRaisesRegex(MusicBrainzError, f"place place-0 is deeper than {MAX_AREA_DEPTH} levels"):
            collect_musicbrainz(client, DEADLINE_TOUR)
        self.assertEqual(sum(entity == "area" for entity, _ in client.lookups), MAX_AREA_DEPTH)

    def test_the_depth_error_escapes_the_place_mbid(self):
        entities = self.entities(1, MAX_AREA_DEPTH + 1)
        entities[("event", "event-0")] = event_at("place-0\n::error::x")
        entities[("place", "place-0\n::error::x")] = entities.pop(("place", "place-0"))

        with self.assertRaises(MusicBrainzError) as caught:
            collect_musicbrainz(FakeMusicBrainz(entities), DEADLINE_TOUR)
        self.assertNotIn("\n", str(caught.exception))
        self.assertIn("place-0%0A::error::x", str(caught.exception))

    def test_the_limit_covers_the_committed_dataset(self):
        dataset = json.loads(DATASET.read_text(encoding="utf-8"))
        self.assertLess(len(dataset["events"]) + len(dataset["unmatched_schedule_dates"]), MAX_SERIES_EVENTS)


class WikidataCountryTest(unittest.TestCase):
    def statement(self, value, rank="normal", ended=False):
        qualifiers = {"P582": [{}]} if ended else {}
        return {"rank": rank, "qualifiers": qualifiers, "mainsnak": {"datavalue": {"value": {"id": value}}}}

    def test_skips_ended_and_deprecated_statements(self):
        entity = {"claims": {"P17": [
            self.statement("Q869"),
            self.statement("Q1155700", ended=True),
            self.statement("Q1", rank="deprecated"),
        ]}}
        self.assertEqual(current_item_values(entity, "P17"), frozenset({"Q869"}))

    def test_preferred_rank_wins(self):
        entity = {"claims": {"P17": [self.statement("Q1"), self.statement("Q2", rank="preferred")]}}
        self.assertEqual(current_item_values(entity, "P17"), frozenset({"Q2"}))


class WorkflowBudgetTest(unittest.TestCase):
    def test_maxlag_waits_of_every_attempt_fit_in_the_step_timeout(self):
        workflow = (ROOT / ".github" / "workflows" / "map-pilot-refresh.yml").read_text(encoding="utf-8")
        timeout_minutes = int(
            re.search(r"timeout-minutes: (\d+)\n\s+run: \|\n\s+for attempt in", workflow).group(1)
        )
        attempts = len(re.search(r"for attempt in ([\d ]+);", workflow).group(1).split())
        pause = int(re.search(r"sleep (\d+)", workflow).group(1))
        waits = attempts * WIKIDATA_MAXLAG_BUDGET_SECONDS + (attempts - 1) * pause
        # At worst 65 of the 90 minutes; the 4 runs need the rest for their work.
        self.assertLessEqual(waits, (timeout_minutes - 20) * 60)


class BuildDatasetTest(unittest.TestCase):
    def test_accepts_events_confirmed_by_every_source(self):
        dataset, excluded = build()
        self.assertEqual(excluded, [])
        by_date = {event["event_date"]: event for event in dataset["events"]}
        self.assertEqual(sorted(by_date), ["2025-07-22", "2025-10-18", "2026-01-24"])
        self.assertEqual((by_date["2025-07-22"]["country_iso_3166_1"], by_date["2025-07-22"]["map_feature_id"]), ("CA", "CAN"))
        self.assertEqual((by_date["2025-10-18"]["country_iso_3166_1"], by_date["2025-10-18"]["map_feature_id"]), ("TW", "TWN"))
        self.assertEqual((by_date["2026-01-24"]["country_iso_3166_1"], by_date["2026-01-24"]["map_feature_id"]), ("CN", "CHN"))
        self.assertEqual(by_date["2026-01-24"]["country_check_wikidata_id"], "Q986415")
        self.assertEqual(by_date["2026-01-24"]["source_locator"], "HONG KONG > KAI TAK STADIUM > 2026-01-24")
        self.assertTrue(all(event["status"] == "accepted" for event in dataset["events"]))

    def test_lists_schedule_dates_without_musicbrainz_event(self):
        dataset, _ = build()
        self.assertEqual(
            dataset["unmatched_schedule_dates"],
            [{"event_date": "2025-07-23", "official_destination": "TORONTO", "reason": "no accepted MusicBrainz event on this date"}],
        )

    def test_collects_only_the_venue_area_qids(self):
        self.assertEqual(area_wikidata_ids(load_snapshot()), set(AREA_COUNTRIES))

    def test_excludes_country_that_wikidata_contradicts(self):
        area_countries = dict(AREA_COUNTRIES)
        area_countries["Q1586510"] = AreaCountryClaim(1, frozenset({"Q30"}))
        dataset, excluded = build(area_countries=area_countries)
        self.assertNotIn("CA", {event["country_iso_3166_1"] for event in dataset["events"]})
        self.assertEqual([row["reason"] for row in excluded], ["country_conflicts_with_wikidata"])

    def test_excludes_event_whose_city_differs_from_schedule(self):
        dataset, excluded = build(html=SCHEDULE_HTML.replace("KAOHSIUNG</p>", "TAIPEI</p>"))
        self.assertNotIn("2025-10-18", {event["event_date"] for event in dataset["events"]})
        self.assertEqual([row["reason"] for row in excluded], ["city_differs_from_official_schedule"])

    def test_excludes_cancelled_event(self):
        snapshot = load_snapshot()
        snapshot.events[event_id_on(snapshot, "2025-10-18")]["cancelled"] = True
        _, excluded = build(snapshot=snapshot)
        self.assertEqual([row["reason"] for row in excluded], ["event_cancelled"])

    def test_excludes_event_missing_from_schedule(self):
        html = SCHEDULE_HTML.replace("2026. 01. 24.", "2026. 01. 27.")
        dataset, excluded = build(html=html)
        self.assertEqual([row["reason"] for row in excluded], ["date_not_in_official_schedule"])
        self.assertIn("2026-01-27", {row["event_date"] for row in dataset["unmatched_schedule_dates"]})

    def test_excludes_event_where_artist_is_not_main_performer(self):
        snapshot = load_snapshot()
        event = snapshot.events[event_id_on(snapshot, "2025-07-22")]
        for relation in event["relations"]:
            if relation["target-type"] == "artist":
                relation["type"] = "support act"
        _, excluded = build(snapshot=snapshot)
        self.assertEqual([row["reason"] for row in excluded], ["artist_not_main_performer"])

    def test_publishes_nothing_when_artist_links_to_another_qid(self):
        snapshot = load_snapshot()
        for relation in snapshot.artist["relations"]:
            relation["url"]["resource"] = "https://www.wikidata.org/wiki/Q1"
        with self.assertRaises(DatasetError):
            build(snapshot=snapshot)


class CommittedDatasetTest(unittest.TestCase):
    def setUp(self):
        self.dataset = json.loads(DATASET.read_text(encoding="utf-8"))
        self.world_map = load_world_map()

    def test_committed_dataset_is_valid(self):
        validate_map_pilot_dataset(self.dataset, self.world_map)

    def test_hong_kong_resolves_to_china_and_taiwan_to_taiwan(self):
        by_date = {event["event_date"]: event for event in self.dataset["events"]}
        self.assertEqual(by_date["2026-01-24"]["map_feature_id"], "CHN")
        self.assertEqual(by_date["2025-10-18"]["map_feature_id"], "TWN")

    def test_rejects_event_pointing_to_other_country_feature(self):
        dataset = copy.deepcopy(self.dataset)
        dataset["events"][0]["map_feature_id"] = next(
            row["map_feature_id"] for row in dataset["countries"]
            if row["wikidata_id"] != dataset["events"][0]["country_wikidata_id"]
        )
        with self.assertRaisesRegex(DatasetError, "differs from crosswalk"):
            validate_map_pilot_dataset(dataset, self.world_map)

    def test_rejects_duplicate_dates(self):
        dataset = copy.deepcopy(self.dataset)
        dataset["events"][1]["event_date"] = dataset["events"][0]["event_date"]
        with self.assertRaisesRegex(DatasetError, "duplicate event_date"):
            validate_map_pilot_dataset(dataset, self.world_map)


if __name__ == "__main__":
    unittest.main()
