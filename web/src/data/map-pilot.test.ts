import { describe, expect, it } from "vitest";
import eventData from "../../../data/map-pilot/deadline-events.json";
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
