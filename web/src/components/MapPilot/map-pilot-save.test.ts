import { afterEach, describe, expect, it, vi } from "vitest";
import { throwOnLocalStorage } from "../../test/throwing-storage";
import { isMapPilotRoundFinished, mapPilotStorageKey, storeMapPilotSave } from "./map-pilot-save";
import { loadMapPilotSave } from "./map-pilot-progress";

const DATE = "2026-09-24";

describe("map pilot save when localStorage throws", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads no save, counts the round as unfinished and writes nothing", () => {
    localStorage.setItem(mapPilotStorageKey("2026-09-23"), "{}");
    throwOnLocalStorage();
    expect(loadMapPilotSave(DATE, [], new Set())).toBeNull();
    expect(isMapPilotRoundFinished(DATE)).toBe(false);
    expect(() => storeMapPilotSave(DATE, { events: [], answers: [], index: 0 })).not.toThrow();
  });
});
