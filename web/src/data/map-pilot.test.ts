import { describe, expect, it } from "vitest";
import eventData from "../../../data/map-pilot/deadline-events.json";
import { guardAfterChange, guardRows, type GuardCase } from "../test/guard-table";
import {
  isBundledMapPilotDatasetValid,
  isMapPilotDataset,
  mapPilotCountries,
  mapPilotCountryLabel,
  mapPilotEvents,
  selectMapPilotRound,
} from "./map-pilot";

describe("map pilot data", () => {
  it("bundles accepted events with unique IDs and a map feature for every country", () => {
    expect(isBundledMapPilotDatasetValid()).toBe(true);
    expect(isMapPilotDataset(eventData)).toBe(true);
    expect(mapPilotEvents.length).toBeGreaterThanOrEqual(10);
    expect(new Set(mapPilotEvents.map((event) => event.event_mbid)).size).toBe(mapPilotEvents.length);
    expect(mapPilotCountries).toHaveLength(eventData.countries.length);
    expect(mapPilotEvents.every((event) => event.status === "accepted" && event.schedule_status === "listed")).toBe(true);
  });

  it("selects a stable daily round and does not repeat events within it", () => {
    const first = selectMapPilotRound(mapPilotEvents, "2026-09-24");
    expect(selectMapPilotRound(mapPilotEvents, "2026-09-24")).toEqual(first);
    expect(first).toHaveLength(10);
    expect(new Set(first.map((event) => event.event_mbid)).size).toBe(10);
  });

  it("maps Hong Kong venue records to China and Taiwan records to Taiwan", () => {
    const hongKong = mapPilotEvents.filter((event) => event.event_date === "2026-01-24" || event.event_date === "2026-01-25");
    const taiwan = mapPilotEvents.filter((event) => event.event_date === "2025-10-18" || event.event_date === "2025-10-19");
    expect(hongKong).toHaveLength(2);
    expect(hongKong.every((event) => event.country_iso_3166_1 === "CN" && event.map_feature_id === "CHN")).toBe(true);
    expect(taiwan).toHaveLength(2);
    expect(taiwan.every((event) => event.country_iso_3166_1 === "TW" && event.map_feature_id === "TWN")).toBe(true);
  });

  it("localizes country labels for the Portuguese game", () => {
    const china = mapPilotCountries.find((country) => country.iso_3166_1 === "CN")!;
    const unitedStates = mapPilotCountries.find((country) => country.iso_3166_1 === "US")!;
    expect(mapPilotCountryLabel(china, "pt-BR")).toBe("China");
    expect(mapPilotCountryLabel(unitedStates, "pt-BR")).toBe("Estados Unidos");
    expect(mapPilotCountryLabel(unitedStates, "en")).toBe("United States of America");
  });

  it("rejects an event whose MusicBrainz link is not https", () => {
    for (const url of ["javascript:alert(1)", "http://musicbrainz.org/event/1", "https://", ""]) {
      const invalid = structuredClone(eventData);
      invalid.events[0]!.musicbrainz_event_url = url;
      expect(isMapPilotDataset(invalid), url).toBe(false);
    }
  });

  it("rejects an event whose source URL only looks like https", () => {
    const invalid = structuredClone(eventData);
    invalid.events[0]!.source_url = "https://exa mple.com/";
    expect(isMapPilotDataset(invalid)).toBe(false);
  });

  it("rejects duplicate event identities", () => {
    const invalid = structuredClone(eventData);
    invalid.events[1]!.event_mbid = invalid.events[0]!.event_mbid;
    expect(isMapPilotDataset(invalid)).toBe(false);
  });
});

const MAP_CASES: GuardCase[] = [
  ["the bundled data", () => {}, true],
  ["an extra key", (d) => { d.extra = 1; }, true],
  ["another schema", (d) => { d.schema_version = "kpop-map-pilot-events-v1"; }, false],
  ["a reference date that does not exist", (d) => { d.reference_date = "2026-02-30"; }, false],
  ["a reference date before year 100", (d) => { d.reference_date = "0099-01-01"; }, true],
  ["a numeric crosswalk", (d) => { d.country_crosswalk_id = 1; }, false],
  ["an empty crosswalk", (d) => { d.country_crosswalk_id = ""; }, true],
  ["no event", (d) => { d.events = []; }, false],
  ["events that are not a list", (d) => { d.events = {}; }, false],
  ["countries that are not a list", (d) => { d.countries = {}; }, false],
  ["no country", (d) => { d.countries = []; }, false],
  ["an event that is null", (d) => { d.events[0] = null; }, false],
  ["an event with an extra key", (d) => { d.events[0].extra = 1; }, true],
  ["an event without tour", (d) => { delete d.events[0].tour_mbid; }, true],
  ["another predicate", (d) => { d.events[0].predicate = "performed_in_city"; }, false],
  ["a schedule not listed", (d) => { d.events[0].schedule_status = "rumored"; }, false],
  ["an event not accepted", (d) => { d.events[0].status = "pending"; }, false],
  ["a festival", (d) => { d.events[0].event_type = "festival"; }, false],
  ["a co-headliner", (d) => { d.events[0].billing_role = "co_headliner"; }, true],
  ["a support act", (d) => { d.events[0].billing_role = "support"; }, false],
  ["an event date that does not exist", (d) => { d.events[0].event_date = "2026-13-01"; }, false],
  ["a check date before year 100", (d) => { d.events[0].source_checked_at = "0099-01-01"; }, true],
  ["a numeric event id", (d) => { d.events[0].event_mbid = 1; }, false],
  ["a numeric country id", (d) => { d.events[0].country_wikidata_id = 1; }, false],
  ["a numeric country code", (d) => { d.events[0].country_iso_3166_1 = 1; }, false],
  ["a numeric map feature", (d) => { d.events[0].map_feature_id = 1; }, false],
  ["an event on a map feature without country", (d) => { d.events[0].map_feature_id = "ATA"; }, false],
  ["an empty locator", (d) => { d.events[0].source_locator = ""; }, false],
  ["a blank locator", (d) => { d.events[0].source_locator = " "; }, false],
  ["a country with an extra key", (d) => { d.countries[0].extra = 1; }, true],
  ["a numeric country QID", (d) => { d.countries[0].wikidata_id = 1; }, false],
  ["a numeric country ISO code", (d) => { d.countries[0].iso_3166_1 = 1; }, false],
  ["a numeric country map feature", (d) => { d.countries[0].map_feature_id = 1; }, false],
  ["a repeated country", (d) => { d.countries.push(structuredClone(d.countries[0])); }, false],
];

describe("isMapPilotDataset fields", () => {
  it.each(guardRows(MAP_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(eventData, change, isMapPilotDataset)).toBe(accepted);
  });
});

/**
 * reference_date and event dates follow shared isLenientIsoDate (T00 round-trip,
 * years 0000–0099 accepted for historical concerts).
 */
const MAP_PILOT_CALENDAR_DATES = [
  { value: "2026-11-14", accepted: true, label: "year 2026" },
  { value: "2024-02-29", accepted: true, label: "leap day 2024" },
  { value: "2023-02-29", accepted: false, label: "Feb 29 in a common year" },
  { value: "2026-02-30", accepted: false, label: "Feb 30" },
  { value: "2026-13-01", accepted: false, label: "month 13" },
  { value: "0099-01-01", accepted: true, label: "year 0099" },
] as const;

describe("map-pilot calendar date policy", () => {
  it.each(MAP_PILOT_CALENDAR_DATES)(
    "reference_date $label ($value): accepted is $accepted",
    ({ value, accepted }) => {
      expect(guardAfterChange(eventData, (d) => { d.reference_date = value; }, isMapPilotDataset)).toBe(accepted);
    },
  );

  it.each(MAP_PILOT_CALENDAR_DATES)(
    "event_date $label ($value): accepted is $accepted",
    ({ value, accepted }) => {
      expect(guardAfterChange(eventData, (d) => { d.events[0].event_date = value; }, isMapPilotDataset)).toBe(accepted);
    },
  );
});
