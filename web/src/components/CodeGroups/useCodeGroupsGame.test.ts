import { act, renderHook } from "@testing-library/preact";
import { beforeEach, expect, it } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { useCodeGroupsGame } from "./useCodeGroupsGame";

beforeEach(() => localStorage.clear());
it("counts same-turn duplicate submission once but allows a later deliberate repeat", () => {
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
  expect(result.current.history).toHaveLength(2);
});
