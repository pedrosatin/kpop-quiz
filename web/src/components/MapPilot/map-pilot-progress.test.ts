import { afterEach, describe, expect, it } from "vitest";
import { mapPilotCountries, mapPilotEvents, selectMapPilotRound } from "../../data/map-pilot";
import {
  loadMapPilotSave,
  parseMapPilotSave,
  roundStateFromSave,
  saveOfRound,
  shouldSaveRound,
} from "./map-pilot-progress";
import { mapPilotStorageKey } from "./map-pilot-save";

const DATE = "2026-09-24";
const round = selectMapPilotRound(mapPilotEvents, DATE);
const events = round.map((event) => event.event_mbid);
const right = round.map((event) => event.map_feature_id);
const playable = new Set(mapPilotCountries.map((country) => country.map_feature_id));

function parse(save: unknown): ReturnType<typeof parseMapPilotSave> {
  return parseMapPilotSave(JSON.stringify(save), round, playable);
}

describe("parseMapPilotSave", () => {
  it("keeps an open round on an unanswered or an answered date", () => {
    expect(parse({ events, answers: right.slice(0, 2), index: 2 })).toEqual({ events, answers: right.slice(0, 2), index: 2 });
    expect(parse({ events, answers: right.slice(0, 3), index: 2 })).toEqual({ events, answers: right.slice(0, 3), index: 2 });
  });

  it("keeps a finished round, a give-up with fewer answers and the replay mark", () => {
    expect(parse({ events, answers: right, index: 10 })).toEqual({ events, answers: right, index: 10 });
    expect(parse({ events, answers: right.slice(0, 2), index: 10, gaveUp: true }))
      .toEqual({ events, answers: right.slice(0, 2), index: 10, gaveUp: true });
    expect(parse({ events, answers: [], index: 0, replay: true })).toEqual({ events, answers: [], index: 0, replay: true });
  });

  it("drops the false marks and the keys it does not know", () => {
    expect(parse({ events, answers: [], index: 0, gaveUp: false, replay: "yes", extra: 1 })).toEqual({ events, answers: [], index: 0 });
  });

  it.each<[string, string | null]>([
    ["no save", null],
    ["an empty string", ""],
    ["malformed JSON", "{"],
    ["null", "null"],
    ["a number", "3"],
    ["an array", "[]"],
  ])("drops %s", (_name, raw) => {
    expect(parseMapPilotSave(raw, round, playable)).toBeNull();
  });

  it.each<[string, unknown]>([
    ["events of another round", { events: [...events].reverse(), answers: [], index: 0 }],
    ["fewer events", { events: events.slice(1), answers: [], index: 0 }],
    ["events that are not a list", { events: "x", answers: [], index: 0 }],
    ["a feature outside the countries", { events, answers: ["ATA"], index: 1 }],
    ["a non-string answer", { events, answers: [3], index: 1 }],
    ["answers that are not a list", { events, answers: "FRA", index: 0 }],
    ["a fractional index", { events, answers: right.slice(0, 2), index: 1.5 }],
    ["a negative index", { events, answers: [], index: -1 }],
    ["an index past the round", { events, answers: right, index: 11 }],
    ["an index as text", { events, answers: [], index: "0" }],
    ["a give-up flag that is not a boolean", { events, answers: [], index: 10, gaveUp: "yes" }],
    ["a give-up before the result", { events, answers: [], index: 0, gaveUp: true }],
    ["answers ahead of the date", { events, answers: right.slice(0, 3), index: 1 }],
    ["answers behind the date", { events, answers: right.slice(0, 1), index: 3 }],
    ["more answers than dates", { events, answers: [...right, "FRA"], index: 10 }],
  ])("drops a save with %s", (_name, save) => {
    expect(parse(save)).toBeNull();
  });
});

describe("loadMapPilotSave", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("reads this round's save and removes the saves of other days only", () => {
    localStorage.setItem(mapPilotStorageKey(DATE), JSON.stringify({ events, answers: right.slice(0, 1), index: 1 }));
    localStorage.setItem(mapPilotStorageKey("2026-09-23"), "{}");
    localStorage.setItem("kpop-map-settings", "keep");
    expect(loadMapPilotSave(DATE, round, playable)).toEqual({ events, answers: right.slice(0, 1), index: 1 });
    expect(Object.keys(localStorage).sort()).toEqual([mapPilotStorageKey(DATE), "kpop-map-settings"]);
  });

  it("removes other days even when this round has no save", () => {
    localStorage.setItem(mapPilotStorageKey("2025-01-01"), "{}");
    expect(loadMapPilotSave(DATE, round, playable)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("roundStateFromSave", () => {
  it("starts on the first date with no save", () => {
    expect(roundStateFromSave(DATE, null)).toEqual({ date: DATE, gaveUp: false, answers: [], index: 0, replay: false });
  });

  it("resumes the saved date, answers and marks", () => {
    expect(roundStateFromSave(DATE, { events, answers: right.slice(0, 2), index: 10, gaveUp: true, replay: true }))
      .toEqual({ date: DATE, gaveUp: true, answers: right.slice(0, 2), index: 10, replay: true });
    expect(roundStateFromSave(DATE, { events, answers: right.slice(0, 2), index: 2 }))
      .toEqual({ date: DATE, gaveUp: false, answers: right.slice(0, 2), index: 2, replay: false });
  });
});

describe("shouldSaveRound", () => {
  const untouched = { date: DATE, answers: [], index: 0 };

  it("does not save an untouched round or an empty round", () => {
    expect(shouldSaveRound(untouched, round, false)).toBe(false);
    expect(shouldSaveRound({ ...untouched, answers: ["FRA"] }, [], false)).toBe(false);
  });

  it("saves a round with an answer, a finished round and a replay", () => {
    expect(shouldSaveRound({ ...untouched, answers: ["FRA"] }, round, false)).toBe(true);
    expect(shouldSaveRound({ ...untouched, index: 10, gaveUp: true }, round, true)).toBe(true);
    expect(shouldSaveRound({ ...untouched, replay: true }, round, false)).toBe(true);
  });
});

describe("saveOfRound", () => {
  it("writes the round's events, the answers, the date on screen and only the true marks", () => {
    expect(saveOfRound({ date: DATE, answers: ["FRA"], index: 1, gaveUp: false, replay: false }, round))
      .toEqual({ events, answers: ["FRA"], index: 1 });
    expect(JSON.stringify(saveOfRound({ date: DATE, answers: [], index: 10, gaveUp: true, replay: true }, round)))
      .toBe(JSON.stringify({ events, answers: [], index: 10, gaveUp: true, replay: true }));
  });
});
