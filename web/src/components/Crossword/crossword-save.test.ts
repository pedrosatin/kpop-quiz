import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrosswordPuzzle } from "../../data/crossword";
import { throwOnLocalStorage } from "../../test/throwing-storage";
import { clearCrosswordSave, crosswordStorageKey, loadCrosswordSave, storeCrosswordSave } from "./crossword-save";

const puzzle = { dataset_version: "a".repeat(64) } as CrosswordPuzzle;

describe("crossword save when localStorage throws", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads no save and writes nothing without throwing", () => {
    localStorage.setItem(crosswordStorageKey({ dataset_version: "b".repeat(64) }), "{}");
    throwOnLocalStorage();
    expect(loadCrosswordSave(puzzle)).toBeNull();
    expect(() => storeCrosswordSave(puzzle, { values: {}, checks: 0, status: "playing" })).not.toThrow();
    expect(() => clearCrosswordSave(puzzle)).not.toThrow();
  });
});
