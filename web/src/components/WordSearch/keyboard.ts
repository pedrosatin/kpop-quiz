import type { CellCoord } from "./types";
import type { WordSearchDimensions } from "../../lib/word-search-types";

export interface KeyboardNavContext {
  focusedCell: CellCoord;
  anchorCell: CellCoord | null;
  dimensions: WordSearchDimensions;
  setFocusedCell: (cell: CellCoord) => void;
  setCurrentHoverCell: (cell: CellCoord | null) => void;
  /** Enter or Space on a cell: the same as a tap on it. */
  tap: (cell: CellCoord) => void;
  /** Drops the start marked so far and says so. */
  cancel: () => void;
}

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function clamp(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

export function handleWordSearchKeyDown(e: KeyboardEvent, ctx: KeyboardNavContext): void {
  const { focusedCell, anchorCell, dimensions } = ctx;

  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    ctx.tap(focusedCell);
    return;
  }
  if (e.key === "Escape") {
    // Handled here, so the page-wide Esc of the selection skips it.
    if (anchorCell) {
      e.preventDefault();
      ctx.cancel();
    }
    return;
  }
  const move = MOVES[e.key];
  if (!move) return;

  e.preventDefault();
  const next = {
    row: clamp(focusedCell.row + move[0], dimensions.rows),
    col: clamp(focusedCell.col + move[1], dimensions.cols),
  };
  ctx.setFocusedCell(next);
  if (anchorCell) ctx.setCurrentHoverCell(next);
}
