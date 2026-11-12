import { act, renderHook } from "@testing-library/preact";
import { beforeEach, expect, it } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { useCodeGroupsGame } from "./useCodeGroupsGame";

beforeEach(() => localStorage.clear());
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
