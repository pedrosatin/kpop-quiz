import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFoundWordIds, loadStoredProgress, storeProgress, storedSeconds, wordSearchStorageKey } from "./word-search-save";
import { throwOnLocalStorage } from "../../test/throwing-storage";

const key = wordSearchStorageKey("abc");
const fresh = { foundWordIds: [], elapsedSeconds: 0, status: "in_progress", easyMode: false, clueMode: false };

function load(save: unknown, valid?: ReadonlySet<string>) {
  localStorage.setItem(key, typeof save === "string" ? save : JSON.stringify(save));
  return loadStoredProgress(key, valid);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("wordSearchStorageKey", () => {
  it("keeps one save per puzzle under the old key", () => {
    expect(key).toBe("kpop-word-search-abc");
  });
});

describe("isFoundWordIds", () => {
  it("takes distinct strings, all of the puzzle's words when given", () => {
    expect(isFoundWordIds(["Q1", "Q2"])).toBe(true);
    expect(isFoundWordIds([])).toBe(true);
    expect(isFoundWordIds(["Q1", "Q2"], new Set(["Q1", "Q2", "Q3"]))).toBe(true);
    expect(isFoundWordIds(["Q4"], new Set(["Q1"]))).toBe(false);
    expect(isFoundWordIds(["Q1", "Q1"])).toBe(false);
    expect(isFoundWordIds([1])).toBe(false);
    expect(isFoundWordIds("Q1")).toBe(false);
  });
});

describe("storedSeconds", () => {
  it("keeps finite counts from zero up and turns the rest into 0", () => {
    expect(storedSeconds(12)).toBe(12);
    expect(storedSeconds(0)).toBe(0);
    expect(storedSeconds(2.5)).toBe(2.5);
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "12", null, undefined]) expect(storedSeconds(value)).toBe(0);
  });
});

describe("loadStoredProgress", () => {
  it("starts fresh without a save, or with one it cannot read", () => {
    expect(loadStoredProgress(key)).toEqual(fresh);
    for (const raw of ["", "{", "null", "[]", "3"]) expect(load(raw)).toEqual(fresh);
  });

  it("starts fresh when the found words are not a list of distinct known ids", () => {
    const valid = new Set(["Q1", "Q2"]);
    expect(load({ foundWordIds: "Q1" }, valid)).toEqual(fresh);
    expect(load({ foundWordIds: ["Q1", "Q1"] }, valid)).toEqual(fresh);
    expect(load({ foundWordIds: ["Q9"] }, valid)).toEqual(fresh);
    expect(load({ elapsedSeconds: 30, status: "completed" }, valid)).toEqual(fresh);
  });

  it("falls back field by field once the found words are valid", () => {
    expect(load({ foundWordIds: ["Q1"], elapsedSeconds: -4, status: "done", easyMode: "" })).toEqual({
      foundWordIds: ["Q1"],
      elapsedSeconds: 0,
      status: "in_progress",
      easyMode: false,
      clueMode: false,
    });
  });

  it("reads an old save's clue mode as easy mode, and easy mode first when both are there", () => {
    expect(load({ foundWordIds: [], clueMode: true })).toMatchObject({ easyMode: true, clueMode: true });
    expect(load({ foundWordIds: [], easyMode: false, clueMode: true })).toMatchObject({ easyMode: false, clueMode: false });
  });

  it("starts fresh when storage cannot be read", () => {
    throwOnLocalStorage();
    expect(loadStoredProgress(key)).toEqual(fresh);
    vi.restoreAllMocks();
  });
});

describe("storeProgress", () => {
  it("writes the fields in the order the game always wrote them, and reads back the same round", () => {
    const round = { foundWordIds: ["Q1"], elapsedSeconds: 61, status: "completed" as const, easyMode: true };
    storeProgress(key, round);
    expect(localStorage.getItem(key)).toBe('{"foundWordIds":["Q1"],"elapsedSeconds":61,"status":"completed","easyMode":true}');
    expect(loadStoredProgress(key)).toEqual({ ...round, clueMode: true });
  });
});
