import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { throwOnLocalStorage } from "../../test/throwing-storage";
import { clearCodeGroupsSave, codeGroupsStorageKey, loadCodeGroupsSave, storeCodeGroupsSave } from "./code-groups-save";
import { useCodeGroupsGame } from "./useCodeGroupsGame";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("counts same-turn duplicate submission once and refuses a later repeat without an attempt", () => {
  const puzzle = fixture as CodeGroupsPuzzle;
  const { result } = renderHook(() => useCodeGroupsGame(puzzle, "pt-BR"));
  const guess = [...puzzle.secret].reverse();
  act(() => { guess.forEach((id, index) => result.current.selectValue(index, id)); });
  act(() => {
    result.current.submit();
    result.current.submit();
  });
  expect(result.current.history).toHaveLength(1);
  act(() => result.current.submit());
  expect(result.current.history).toHaveLength(1);
  expect(result.current.feedback).toEqual({ kind: "alreadyGuessed" });
  // Changing one slot makes it a new guess again.
  act(() => result.current.selectValue(0, guess[1]!));
  act(() => result.current.selectValue(1, guess[0]!));
  act(() => result.current.submit());
  expect(result.current.history).toHaveLength(2);
  expect(result.current.feedback?.kind).toBe("attempt");
});

it("plays a guess without a save when localStorage throws", () => {
  const puzzle = fixture as CodeGroupsPuzzle;
  localStorage.setItem(codeGroupsStorageKey("2000-01-01"), "{}");
  throwOnLocalStorage();
  expect(loadCodeGroupsSave(puzzle)).toBeNull();
  expect(() => storeCodeGroupsSave(puzzle, { history: [], selection: [] })).not.toThrow();
  expect(() => clearCodeGroupsSave(puzzle)).not.toThrow();
  const { result } = renderHook(() => useCodeGroupsGame(puzzle, "pt-BR"));
  const guess = [...puzzle.secret].reverse();
  act(() => { guess.forEach((id, index) => result.current.selectValue(index, id)); });
  act(() => result.current.submit());
  expect(result.current.history).toHaveLength(1);
});
