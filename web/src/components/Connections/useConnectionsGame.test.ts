import { renderHook, act } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../../public/data/connections.daily.json";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { useConnectionsGame } from "./useConnectionsGame";

const puzzle = validPuzzleJson as unknown as ConnectionsPuzzle;

function submitIds(result: { current: ReturnType<typeof useConnectionsGame> }, ids: string[]) {
  act(() => {
    ids.forEach((id) => result.current.toggleSelectItem(id));
  });
  let res;
  act(() => {
    res = result.current.submitGuess();
  });
  return res;
}

describe("useConnectionsGame state machine", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("initializes with 4 mistakes, empty selection and shuffled board items", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    expect(result.current.mistakesRemaining).toBe(4);
    expect(result.current.gameStatus).toBe("in_progress");
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.solvedCategoryIds).toEqual([]);
    expect(result.current.boardItemIds).toHaveLength(16);
  });

  it("selects items up to 4 and deselects on toggle", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const [id0, id1, id2, id3, id4] = puzzle.items.map((i) => i.id);

    act(() => {
      result.current.toggleSelectItem(id0!);
      result.current.toggleSelectItem(id1!);
    });
    expect(result.current.selectedItemIds).toEqual([id0, id1]);

    act(() => { result.current.toggleSelectItem(id0!); });
    expect(result.current.selectedItemIds).toEqual([id1]);

    act(() => {
      result.current.toggleSelectItem(id0!);
      result.current.toggleSelectItem(id2!);
      result.current.toggleSelectItem(id3!);
    });
    expect(result.current.selectedItemIds).toHaveLength(4);

    act(() => { result.current.toggleSelectItem(id4!); });
    expect(result.current.selectedItemIds).toHaveLength(4);
    expect(result.current.selectedItemIds).not.includes(id4);
  });

  it("clears selection with clearSelection", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    act(() => {
      result.current.toggleSelectItem(puzzle.items[0]!.id);
      result.current.toggleSelectItem(puzzle.items[1]!.id);
    });
    expect(result.current.selectedItemIds).toHaveLength(2);
    act(() => { result.current.clearSelection(); });
    expect(result.current.selectedItemIds).toEqual([]);
  });

  it("shuffles board items with shuffleItems", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const initialOrder = [...result.current.boardItemIds];
    act(() => { result.current.shuffleItems(); });
    expect(result.current.boardItemIds).toHaveLength(16);
    expect(new Set(result.current.boardItemIds)).toEqual(new Set(initialOrder));
  });

  it("correctly identifies a solved category", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const jypCategory = puzzle.categories.find((c) => c.id === "cat_jyp")!;
    const guessResult = submitIds(result, jypCategory.item_ids);

    expect(guessResult).toEqual({ success: true, oneAway: false, category: jypCategory });
    expect(result.current.solvedCategoryIds).toEqual(["cat_jyp"]);
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.boardItemIds).toHaveLength(12);
    expect(result.current.mistakesRemaining).toBe(4);
  });

  it("detects one-away proximity feedback on incorrect guess", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const jypCategory = puzzle.categories.find((c) => c.id === "cat_jyp")!;
    const oneSm = puzzle.categories.find((c) => c.id === "cat_sm")!.item_ids[0]!;
    const guess = [...jypCategory.item_ids.slice(0, 3), oneSm];

    const guessResult = submitIds(result, guess);
    expect(guessResult).toEqual({ success: false, oneAway: true });
    expect(result.current.proximityFeedback).toBe(true);
    expect(result.current.mistakesRemaining).toBe(3);
  });

  it("handles duplicate guesses without deducting additional mistakes", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const wrong = [puzzle.items[0]!.id, puzzle.items[4]!.id, puzzle.items[8]!.id, puzzle.items[12]!.id];

    submitIds(result, wrong);
    expect(result.current.mistakesRemaining).toBe(3);

    act(() => { result.current.submitGuess(); });
    expect(result.current.alreadyGuessedFeedback).toBe(true);
    expect(result.current.mistakesRemaining).toBe(3);
  });

  it("ends in defeat and reveals all categories when 4 mistakes are exhausted", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const wrong = [
      [puzzle.items[0]!.id, puzzle.items[4]!.id, puzzle.items[8]!.id, puzzle.items[12]!.id],
      [puzzle.items[1]!.id, puzzle.items[5]!.id, puzzle.items[9]!.id, puzzle.items[13]!.id],
      [puzzle.items[2]!.id, puzzle.items[6]!.id, puzzle.items[10]!.id, puzzle.items[14]!.id],
      [puzzle.items[3]!.id, puzzle.items[7]!.id, puzzle.items[11]!.id, puzzle.items[15]!.id],
    ];

    for (let i = 0; i < 4; i++) {
      act(() => { result.current.clearSelection(); });
      submitIds(result, wrong[i]!);
    }

    expect(result.current.mistakesRemaining).toBe(0);
    expect(result.current.gameStatus).toBe("lost");
    expect(result.current.solvedCategoryIds).toHaveLength(4);
    expect(result.current.boardItemIds).toHaveLength(0);
  });

  it("ends in victory when all 4 categories are solved", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    for (const cat of puzzle.categories) {
      act(() => { result.current.clearSelection(); });
      submitIds(result, cat.item_ids);
    }
    expect(result.current.gameStatus).toBe("won");
    expect(result.current.solvedCategoryIds).toHaveLength(4);
    expect(result.current.boardItemIds).toHaveLength(0);
  });

  it("persists game progress to localStorage and restores it", () => {
    const key = `kpop-connections-${puzzle.puzzle_id}`;
    const { result, unmount } = renderHook(() => useConnectionsGame(puzzle));
    const jypCategory = puzzle.categories.find((c) => c.id === "cat_jyp")!;

    submitIds(result, jypCategory.item_ids);
    expect(localStorage.getItem(key)).not.toBeNull();
    unmount();

    const { result: newResult } = renderHook(() => useConnectionsGame(puzzle));
    expect(newResult.current.solvedCategoryIds).toEqual(["cat_jyp"]);
    expect(newResult.current.boardItemIds).toHaveLength(12);
  });

  it("resets state on restartGame", () => {
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    const jypCategory = puzzle.categories.find((c) => c.id === "cat_jyp")!;
    submitIds(result, jypCategory.item_ids);
    expect(result.current.solvedCategoryIds).toHaveLength(1);

    act(() => { result.current.restartGame(); });
    expect(result.current.solvedCategoryIds).toEqual([]);
    expect(result.current.mistakesRemaining).toBe(4);
    expect(result.current.gameStatus).toBe("in_progress");
  });

  it("ignores corrupted saved state with empty boardItemIds or missing fields", () => {
    const key = `kpop-connections-${puzzle.puzzle_id}`;
    localStorage.setItem(
      key,
      JSON.stringify({ boardItemIds: [], solvedCategoryIds: [], guessHistory: [], mistakesRemaining: 4, gameStatus: "in_progress" })
    );
    const { result } = renderHook(() => useConnectionsGame(puzzle));
    expect(result.current.boardItemIds).toHaveLength(16);
  });
});
