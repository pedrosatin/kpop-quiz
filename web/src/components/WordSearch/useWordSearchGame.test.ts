import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useWordSearchGame } from "./useWordSearchGame";
import { getLinearPath, formatTime, generateWordSearchShareSummary } from "./utils";
import validPuzzle from "../../../public/data/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";

describe("Word Search utilities", () => {
  it("computes horizontal linear paths", () => {
    const path = getLinearPath({ row: 0, col: 0 }, { row: 0, col: 3 });
    expect(path).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 0, col: 3 },
    ]);
  });

  it("computes reverse vertical linear paths", () => {
    const path = getLinearPath({ row: 3, col: 2 }, { row: 1, col: 2 });
    expect(path).toEqual([
      { row: 3, col: 2 },
      { row: 2, col: 2 },
      { row: 1, col: 2 },
    ]);
  });

  it("computes diagonal linear paths", () => {
    const path = getLinearPath({ row: 1, col: 1 }, { row: 3, col: 3 });
    expect(path).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 3 },
    ]);
  });

  it("returns empty array for non-linear paths", () => {
    const path = getLinearPath({ row: 0, col: 0 }, { row: 1, col: 2 });
    expect(path).toEqual([]);
  });

  it("formats elapsed time properly", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(135)).toBe("02:15");
  });

  it("generates compliant share summary", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const summary = generateWordSearchShareSummary(puzzle, 5, 5, 135);
    expect(summary).toBe(`K-pop Word Search 2026-09-18 5/5 (02:15)`);
  });
});

describe("useWordSearchGame hook", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("initializes with empty found words and status in_progress", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    expect(result.current.foundWordIds).toEqual([]);
    expect(result.current.status).toBe("in_progress");
    expect(result.current.clueMode).toBe(false);
  });

  it("finds a word via pointer events forward", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    act(() => {
      result.current.handleCellPointerDown(target.start_row, target.start_col);
    });
    expect(result.current.anchorCell).toEqual({ row: target.start_row, col: target.start_col });

    act(() => {
      result.current.handleCellPointerEnter(target.end_row, target.end_col);
      result.current.handleCellPointerUp(target.end_row, target.end_col);
    });

    expect(result.current.foundWordIds).toContain(target.id);
    expect(result.current.anchorCell).toBeNull();
    expect(result.current.announcement).toContain("Palavra encontrada");
  });

  it("finds a word via reverse coordinates", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    act(() => {
      result.current.handleCellPointerDown(target.end_row, target.end_col);
    });
    act(() => {
      result.current.handleCellPointerUp(target.start_row, target.start_col);
    });

    expect(result.current.foundWordIds).toContain(target.id);
  });

  it("navigates grid and selects word via keyboard", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.word === "LEESUNGMIN")!; // from (0,0) to (9,0)
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    // Start at (0,0)
    act(() => {
      result.current.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(result.current.anchorCell).toEqual({ row: 0, col: 0 });

    // Move down 9 times to (9,0)
    for (let i = 0; i < 9; i++) {
      act(() => {
        result.current.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
    }
    expect(result.current.focusedCell).toEqual({ row: 9, col: 0 });

    // Press Enter to confirm selection
    act(() => {
      result.current.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    });

    expect(result.current.foundWordIds).toContain(target.id);
  });

  it("toggles clue mode", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    expect(result.current.clueMode).toBe(false);
    act(() => {
      result.current.setClueMode(true);
    });
    expect(result.current.clueMode).toBe(true);
  });

  it("completes game when all words are found", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    for (const w of puzzle.words) {
      act(() => {
        result.current.handleCellPointerDown(w.start_row, w.start_col);
        result.current.handleCellPointerUp(w.end_row, w.end_col);
      });
    }

    expect(result.current.status).toBe("completed");
    expect(result.current.foundWordIds.length).toBe(puzzle.words.length);
  });
});
