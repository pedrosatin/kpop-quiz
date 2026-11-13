import { describe, expect, it, vi } from "vitest";
import validPuzzle from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { gridPositionAt, nearestCell, sameCell, snapToLine } from "./geometry";
import { judgeSelection, resolveTap } from "./selection";
import { handleWordSearchKeyDown, type KeyboardNavContext } from "./keyboard";

const puzzle = validPuzzle as unknown as WordSearchPuzzle;
const dims = { rows: 12, cols: 12 };
const box = (left: number, top: number, size = 24) => ({ left, top, width: size, height: size });

describe("gridPositionAt", () => {
  // Cells of 24px every 26px: the first at (10, 100), the last at (10 + 11 * 26, 100 + 11 * 26).
  const first = box(10, 100);
  const last = box(10 + 11 * 26, 100 + 11 * 26);

  it("puts the center of a cell on whole numbers", () => {
    expect(gridPositionAt(first, last, dims, 22, 112)).toEqual({ row: 0, col: 0 });
    expect(gridPositionAt(first, last, dims, 22 + 3 * 26, 112 + 5 * 26)).toEqual({ row: 5, col: 3 });
  });

  it("gives a point in the gap to the nearer cell", () => {
    // The gap between columns 0 and 1 runs from x=34 to x=36.
    const position = gridPositionAt(first, last, dims, 34.5, 112)!;
    expect(nearestCell(position, dims)).toEqual({ row: 0, col: 0 });
    expect(nearestCell(gridPositionAt(first, last, dims, 35.5, 112)!, dims)).toEqual({ row: 0, col: 1 });
  });

  it("has no position without layout", () => {
    expect(gridPositionAt(box(0, 0, 0), box(0, 0, 0), dims, 5, 5)).toBeNull();
    expect(gridPositionAt(first, first, dims, 5, 5)).toBeNull();
    expect(gridPositionAt(first, last, { rows: 1, cols: 12 }, 5, 5)).toBeNull();
  });
});

describe("nearestCell", () => {
  it("keeps the cell inside the grid", () => {
    expect(nearestCell({ row: -0.7, col: 12.4 }, dims)).toEqual({ row: 0, col: 11 });
    expect(nearestCell({ row: 3.49, col: 3.51 }, dims)).toEqual({ row: 3, col: 4 });
  });
});

describe("snapToLine", () => {
  const start = { row: 5, col: 5 };

  it.each([
    [{ row: 5, col: 9 }, { row: 5, col: 9 }],
    [{ row: 5, col: 1 }, { row: 5, col: 1 }],
    [{ row: 1, col: 5 }, { row: 1, col: 5 }],
    [{ row: 9, col: 5 }, { row: 9, col: 5 }],
    [{ row: 8, col: 8 }, { row: 8, col: 8 }],
    [{ row: 2, col: 2 }, { row: 2, col: 2 }],
    [{ row: 8, col: 2 }, { row: 8, col: 2 }],
    [{ row: 2, col: 8 }, { row: 2, col: 8 }],
  ])("follows the eight directions to %o", (position, end) => {
    expect(snapToLine(start, position, dims)).toEqual(end);
  });

  it("keeps the line when the pointer strays beside it", () => {
    expect(snapToLine(start, { row: 5.9, col: 9.2 }, dims)).toEqual({ row: 5, col: 9 });
    expect(snapToLine(start, { row: 8.6, col: 7.6 }, dims)).toEqual({ row: 8, col: 8 });
  });

  it("stops at the edge of the grid", () => {
    expect(snapToLine(start, { row: 5, col: 30 }, dims)).toEqual({ row: 5, col: 11 });
    expect(snapToLine(start, { row: -9, col: -9 }, dims)).toEqual({ row: 0, col: 0 });
    expect(snapToLine({ row: 10, col: 2 }, { row: 14, col: -2 }, dims)).toEqual({ row: 11, col: 1 });
  });

  it("stays on the start within half a cell", () => {
    expect(snapToLine(start, { row: 5.2, col: 5.3 }, dims)).toEqual(start);
  });
});

describe("sameCell", () => {
  it("needs two cells", () => {
    expect(sameCell(null, { row: 0, col: 0 })).toBe(false);
    expect(sameCell({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
  });
});

describe("judgeSelection", () => {
  const shindong = puzzle.words.find((w) => w.word === "SHINDONG")!;

  it("finds a name and repeats it once found", () => {
    const start = { row: shindong.start_row, col: shindong.start_col };
    const end = { row: shindong.end_row, col: shindong.end_col };
    expect(judgeSelection(puzzle, [], start, end, "pt-BR")).toEqual({ kind: "found", wordId: shindong.id });
    expect(judgeSelection(puzzle, [shindong.id], end, start, "pt-BR")).toEqual({ kind: "repeat", wordId: shindong.id });
  });

  it("tells a piece of a name from letters that are no name", () => {
    expect(judgeSelection(puzzle, [], { row: 7, col: 10 }, { row: 4, col: 10 }, "pt-BR")).toEqual({ kind: "partial", letters: "SHIN" });
    expect(judgeSelection(puzzle, [], { row: 0, col: 1 }, { row: 0, col: 3 }, "pt-BR")).toEqual({ kind: "miss", letters: "HTA" });
  });

  it("points a piece of a name already found back to that name", () => {
    expect(judgeSelection(puzzle, [shindong.id], { row: 7, col: 10 }, { row: 4, col: 10 }, "en")).toEqual({ kind: "repeat", wordId: shindong.id });
  });

  it("counts a selection that runs past a name as a miss", () => {
    // SHINDONG runs up column 10 from row 7; row 8 is one letter past its start.
    expect(judgeSelection(puzzle, [], { row: 8, col: 10 }, { row: 0, col: 10 }, "pt-BR").kind).toBe("miss");
  });
});

describe("resolveTap", () => {
  it("starts, cancels, checks or moves the start", () => {
    expect(resolveTap(null, { row: 1, col: 1 })).toBe("start");
    expect(resolveTap({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe("cancel");
    expect(resolveTap({ row: 1, col: 1 }, { row: 4, col: 4 })).toBe("check");
    expect(resolveTap({ row: 1, col: 1 }, { row: 2, col: 3 })).toBe("offline");
  });
});

describe("handleWordSearchKeyDown", () => {
  const context = (anchorCell: KeyboardNavContext["anchorCell"] = null): KeyboardNavContext => ({
    focusedCell: { row: 0, col: 11 },
    anchorCell,
    dimensions: dims,
    setFocusedCell: vi.fn(),
    setCurrentHoverCell: vi.fn(),
    tap: vi.fn(),
    cancel: vi.fn(),
  });
  const key = (name: string) => new KeyboardEvent("keydown", { key: name, cancelable: true });

  it("leaves Esc to the page when nothing is selected", () => {
    const ctx = context();
    const event = key("Escape");
    handleWordSearchKeyDown(event, ctx);
    expect(ctx.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("cancels a marked start with Esc and keeps the page from cancelling it again", () => {
    const ctx = context({ row: 0, col: 0 });
    const event = key("Escape");
    handleWordSearchKeyDown(event, ctx);
    expect(ctx.cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("taps the focused cell with Space and ignores other keys", () => {
    const ctx = context();
    handleWordSearchKeyDown(key(" "), ctx);
    expect(ctx.tap).toHaveBeenCalledWith({ row: 0, col: 11 });
    const other = key("a");
    handleWordSearchKeyDown(other, ctx);
    expect(other.defaultPrevented).toBe(false);
  });

  it("moves inside the grid and drags the hover along with a start marked", () => {
    const ctx = context({ row: 0, col: 0 });
    handleWordSearchKeyDown(key("ArrowRight"), ctx);
    expect(ctx.setFocusedCell).toHaveBeenCalledWith({ row: 0, col: 11 });
    handleWordSearchKeyDown(key("ArrowDown"), ctx);
    expect(ctx.setCurrentHoverCell).toHaveBeenLastCalledWith({ row: 1, col: 11 });
  });
});
