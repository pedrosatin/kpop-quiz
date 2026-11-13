import type { WordSearchDimensions } from "../../lib/word-search-types";
import { gridPositionAt, type GridPosition } from "./geometry";

/**
 * Where a pointer event falls on the grid, in cell units, from the boxes of
 * the first and the last cell: a point in a gap or in the grid's padding
 * belongs to the nearest cell, and a drag past the edge still reports where
 * it went. Without layout (tests) the cell under the event stands in.
 */
export function pointerPosition(
  grid: HTMLElement | null,
  dimensions: WordSearchDimensions,
  e: PointerEvent,
): GridPosition | null {
  const cells = grid?.querySelectorAll<HTMLElement>(".word-search-cell") ?? [];
  const first = cells[0]?.getBoundingClientRect();
  const last = cells[cells.length - 1]?.getBoundingClientRect();
  const measured = first && last ? gridPositionAt(first, last, dimensions, e.clientX, e.clientY) : null;
  if (measured) return measured;
  const cell = (e.target as Element | null)?.closest?.<HTMLElement>(".word-search-cell");
  return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
}

/**
 * Touch captures the pointer on the element under the finger, often the
 * letter span; releasing it lets moves and the lift reach the grid.
 */
export function releasePointer(e: PointerEvent): void {
  for (const el of [e.target, e.currentTarget] as Element[]) {
    try {
      if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {}
  }
}

export interface CellState {
  selected: boolean;
  /** Index of the found word's color, or undefined. */
  color: number | undefined;
  revealed: boolean;
  anchor: boolean;
}

export function cellClass({ selected, color, revealed, anchor }: CellState): string {
  const found = color !== undefined;
  return [
    "word-search-cell",
    selected ? "is-selected" : "",
    found ? `is-found color-${color}` : "",
    !found && revealed ? "is-revealed" : "",
    anchor ? "is-anchor" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
