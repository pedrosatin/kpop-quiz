import { describe, expect, it } from "vitest";
import { mapPilotEvents, mapPilotFeatures } from "../../data/map-pilot";
import { featureShape, WORLD_VIEW } from "./map-pilot-geometry";
import {
  isMapZoomable,
  isZoomSettled,
  revealsFocusedCountry,
  shownAnswer,
  ZOOM_GUARD_MS,
  zoomsOnClick,
} from "./map-pilot-zoom";

const event = mapPilotEvents[0]!;
const PHONE_BOX = { width: 300, height: 180 };
const feature = (id: string) => mapPilotFeatures.find((candidate) => candidate.id === id)!;

describe("isMapZoomable", () => {
  it("zooms only a measured narrow map while a date is on screen", () => {
    expect(isMapZoomable(true, PHONE_BOX, event)).toBe(true);
    expect(isMapZoomable(false, PHONE_BOX, event)).toBe(false);
    expect(isMapZoomable(true, { width: 0, height: 0 }, event)).toBe(false);
    expect(isMapZoomable(true, PHONE_BOX, undefined)).toBe(false);
  });
});

describe("shownAnswer", () => {
  it("names the answer of the date on screen once it is answered", () => {
    expect(shownAnswer(event, 3, "FRA")).toEqual({ key: `3:${event.map_feature_id}`, feature: event.map_feature_id });
  });

  it("shows nothing before the answer or after the round", () => {
    expect(shownAnswer(event, 3, null)).toEqual({ key: null, feature: null });
    expect(shownAnswer(undefined, 10, "FRA")).toEqual({ key: null, feature: null });
  });
});

describe("zoomsOnClick", () => {
  it("zooms on a pointer press over the whole map of a screen that zooms", () => {
    expect(zoomsOnClick(1, true, false)).toBe(true);
  });

  it("selects instead on a click from assistive technology, when zoomed, or on a wide screen", () => {
    expect(zoomsOnClick(0, true, false)).toBe(false);
    expect(zoomsOnClick(1, true, true)).toBe(false);
    expect(zoomsOnClick(1, false, false)).toBe(false);
  });
});

describe("isZoomSettled", () => {
  it("takes a pick on the whole map at once and on the zoomed map after the guard", () => {
    expect(isZoomSettled(false, 0)).toBe(true);
    expect(isZoomSettled(true, ZOOM_GUARD_MS - 1)).toBe(false);
    expect(isZoomSettled(true, ZOOM_GUARD_MS)).toBe(true);
  });
});

describe("revealsFocusedCountry", () => {
  const france = featureShape(feature("FRA").path).anchor;
  const aroundFrance = { x: france.x - 50, y: france.y - 30, width: 100, height: 60 };

  it("shows the whole map when keyboard focus reaches a country out of the zoomed view", () => {
    expect(revealsFocusedCountry(true, null, aroundFrance, feature("JPN"))).toBe(true);
  });

  it("keeps the view for a country in view, a focus from a tap, or the whole map", () => {
    expect(revealsFocusedCountry(true, null, aroundFrance, feature("FRA"))).toBe(false);
    expect(revealsFocusedCountry(true, { x: 1, y: 1 }, aroundFrance, feature("JPN"))).toBe(false);
    expect(revealsFocusedCountry(false, null, WORLD_VIEW, feature("JPN"))).toBe(false);
  });
});
