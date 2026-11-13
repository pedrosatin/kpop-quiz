import type { CellCoord } from "./types";
import type { WordSearchDimensions } from "../../lib/word-search-types";

/** A point on the grid in cell units: (0, 0) is the center of the first cell. */
export interface GridPosition {
  row: number;
  col: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a screen point falls on the grid, from the boxes of the first and the
 * last cell. The pitch includes the gap, so a point in a gap belongs to the
 * nearer cell and no part of the grid is dead. Null while the grid has no
 * layout (one row or column, or an unrendered grid).
 */
export function gridPositionAt(
  first: Box,
  last: Box,
  dimensions: WordSearchDimensions,
  x: number,
  y: number,
): GridPosition | null {
  const { rows, cols } = dimensions;
  if (rows < 2 || cols < 2 || first.width <= 0 || first.height <= 0) return null;
  const pitchX = (last.left - first.left) / (cols - 1);
  const pitchY = (last.top - first.top) / (rows - 1);
  if (pitchX <= 0 || pitchY <= 0) return null;
  return {
    row: (y - (first.top + first.height / 2)) / pitchY,
    col: (x - (first.left + first.width / 2)) / pitchX,
  };
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

/** The cell nearest to the position, kept inside the grid. */
export function nearestCell(position: GridPosition, dimensions: WordSearchDimensions): CellCoord {
  return {
    row: clampIndex(Math.round(position.row), dimensions.rows),
    col: clampIndex(Math.round(position.col), dimensions.cols),
  };
}

/** How many steps fit from start along one axis before leaving the grid. */
function stepsLeft(start: number, step: number, size: number): number {
  if (step > 0) return size - 1 - start;
  if (step < 0) return start;
  return Infinity;
}

/**
 * The end of a drag from start: the line follows the nearest of the eight
 * directions (each covers 45 degrees around it) and the end is the cell
 * nearest to the pointer's projection on that line, stopped at the grid's
 * edge. The finger can stray sideways and the selection stays straight.
 */
export function snapToLine(start: CellCoord, position: GridPosition, dimensions: WordSearchDimensions): CellCoord {
  const dr = position.row - start.row;
  const dc = position.col - start.col;
  const octant = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
  const stepRow = Math.round(Math.sin((octant * Math.PI) / 4));
  const stepCol = Math.round(Math.cos((octant * Math.PI) / 4));
  const projected = (dr * stepRow + dc * stepCol) / (stepRow * stepRow + stepCol * stepCol);
  const steps = Math.max(
    0,
    Math.min(
      Math.round(projected),
      stepsLeft(start.row, stepRow, dimensions.rows),
      stepsLeft(start.col, stepCol, dimensions.cols),
    ),
  );
  return { row: start.row + steps * stepRow, col: start.col + steps * stepCol };
}

export function sameCell(a: CellCoord | null, b: CellCoord | null): boolean {
  return a !== null && b !== null && a.row === b.row && a.col === b.col;
}
