import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useWordSearchGame } from "./useWordSearchGame";
import { getLinearPath, formatTime, generateWordSearchShareSummary } from "./utils";
import validPuzzle from "../../tests/fixtures/word-search.daily.json";
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
    expect(result.current.announcement).toContain("Você encontrou");
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

  it("processes keys pressed faster than the grid re-renders", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.word === "LEESUNGMIN")!; // from (0,0) to (9,0)
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));
    const { handleKeyDown } = result.current;
    const press = (key: string) => handleKeyDown(new KeyboardEvent("keydown", { key }));

    act(() => {
      press("Enter");
      for (let i = 0; i < 9; i++) press("ArrowDown");
      press("Enter");
    });

    expect(result.current.focusedCell).toEqual({ row: 9, col: 0 });
    expect(result.current.anchorCell).toBeNull();
    expect(result.current.foundWordIds).toContain(target.id);
  });

  it("selects a word via two clicks (first click to anchor, second click to validate)", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    // Click 1 on start cell
    act(() => {
      result.current.handleCellPointerDown(target.start_row, target.start_col);
      result.current.handleCellPointerUp(target.start_row, target.start_col);
    });
    // Anchor remains on start cell
    expect(result.current.anchorCell).toEqual({ row: target.start_row, col: target.start_col });

    // Hover moves to end cell
    act(() => {
      result.current.handleCellPointerEnter(target.end_row, target.end_col);
    });
    expect(result.current.activePath.length).toBe(target.word.length);

    // Click 2 on end cell
    act(() => {
      result.current.handleCellPointerDown(target.end_row, target.end_col);
      result.current.handleCellPointerUp(target.end_row, target.end_col);
    });

    expect(result.current.foundWordIds).toContain(target.id);
    expect(result.current.anchorCell).toBeNull();
  });

  it("cancels anchor when clicking the anchor cell again", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    act(() => {
      result.current.handleCellPointerDown(0, 0);
      result.current.handleCellPointerUp(0, 0);
    });
    expect(result.current.anchorCell).toEqual({ row: 0, col: 0 });

    act(() => {
      result.current.handleCellPointerDown(0, 0);
      result.current.handleCellPointerUp(0, 0);
    });
    expect(result.current.anchorCell).toBeNull();
  });

  it("reanchors to new cell if second click is not collinear", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    act(() => {
      result.current.handleCellPointerDown(0, 0);
      result.current.handleCellPointerUp(0, 0);
    });
    expect(result.current.anchorCell).toEqual({ row: 0, col: 0 });

    // (1, 2) is not collinear with (0, 0)
    act(() => {
      result.current.handleCellPointerDown(1, 2);
      result.current.handleCellPointerUp(1, 2);
    });
    expect(result.current.anchorCell).toEqual({ row: 1, col: 2 });
  });

  it("validates Lee Sungmin when selecting the SUNGMIN subsegment (lines 3 to 9)", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.id === "Q494222")!; // LEESUNGMIN at col 0, rows 0..9
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    // Select subsegment S-U-N-G-M-I-N (row 3 to row 9 in col 0)
    act(() => {
      result.current.handleCellPointerDown(3, 0);
      result.current.handleCellPointerUp(3, 0);
    });
    expect(result.current.anchorCell).toEqual({ row: 3, col: 0 });

    act(() => {
      result.current.handleCellPointerDown(9, 0);
      result.current.handleCellPointerUp(9, 0);
    });

    expect(result.current.foundWordIds).toContain(target.id);
    expect(result.current.anchorCell).toBeNull();
  });

  it("validates Lee Sungmin when selecting SUNGMIN in reverse (lines 9 to 3)", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const target = puzzle.words.find((w) => w.id === "Q494222")!;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    act(() => {
      result.current.handleCellPointerDown(9, 0);
      result.current.handleCellPointerEnter(3, 0);
      result.current.handleCellPointerUp(3, 0);
    });

    expect(result.current.foundWordIds).toContain(target.id);
  });

  it("toggles easy mode and clueMode", () => {
    const puzzle = validPuzzle as unknown as WordSearchPuzzle;
    const { result } = renderHook(() => useWordSearchGame(puzzle, "pt-BR"));

    expect(result.current.easyMode).toBe(false);
    expect(result.current.clueMode).toBe(false);

    act(() => {
      result.current.setEasyMode(true);
    });
    expect(result.current.easyMode).toBe(true);
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
