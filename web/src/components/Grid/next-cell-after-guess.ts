import { cellKey, type GridCellState } from "./types";

/** How long the cells ignore a tap after a guess closes the picker. */
export const CELL_GUARD_MS = 300;

/**
 * The cell that takes focus after a guess: the same cell while it is still
 * open, else the next open cell in reading order, empty cells first.
 */
export function nextCellAfterGuess(
  cells: Record<string, GridCellState>,
  row: number,
  col: number,
): { row: number; col: number } | null {
  if (!cells[cellKey(row, col)]?.solved) return { row, col };
  const start = row * 3 + col;
  const order = Array.from({ length: 8 }, (_, i) => (start + 1 + i) % 9);
  const open = order.filter((i) => !cells[cellKey(Math.floor(i / 3), i % 3)]?.solved);
  const pick = open.find((i) => !cells[cellKey(Math.floor(i / 3), i % 3)]?.failed) ?? open[0];
  return pick === undefined ? null : { row: Math.floor(pick / 3), col: pick % 3 };
}
