import { useCallback, useEffect } from "preact/hooks";
import type { MutableRef } from "preact/hooks";
import type { WordSearchDimensions } from "../../lib/word-search-types";
import type { CellCoord, SelectionCheck } from "./types";
import { nearestCell, sameCell, snapToLine, type GridPosition } from "./geometry";

/**
 * How far, in cell units, the pointer must travel from where it went down
 * before a press becomes a drag. Measured from the raw point, not the cell's
 * center: a tap near a gap that trembles across it stays a tap.
 */
const DRAG_THRESHOLD = 0.5;

/** The selection a press may have to put back. */
export interface Snapshot {
  anchor: CellCoord | null;
  hover: CellCoord | null;
  focus: CellCoord;
  check: SelectionCheck | null;
}

export interface DragState {
  /** The pointer that owns the gesture; other fingers are ignored. */
  pointerId: number;
  /** Raw position where the pointer went down, in cell units. */
  origin: GridPosition;
  /** Cell nearest to origin: the start of a drag, or the cell of a tap. */
  down: CellCoord;
  /** Selection before the press, restored when the browser takes the gesture over. */
  before: Snapshot;
  moved: boolean;
}

/**
 * The end of the line while the press is a drag, or null while it is still a
 * tap: the pointer has not gone half a cell from where it went down, or it
 * has but the line still ends on the first cell.
 */
function dragEnd(current: DragState, position: GridPosition, dimensions: WordSearchDimensions): CellCoord | null {
  const distance = Math.hypot(position.row - current.origin.row, position.col - current.origin.col);
  if (!current.moved && distance < DRAG_THRESHOLD) return null;
  const end = snapToLine(current.down, position, dimensions);
  return current.moved || !sameCell(end, current.down) ? end : null;
}

/** Events without a pointerId (tests, synthetic events) count as pointer 0. */
function owns(current: DragState | null, e: PointerEvent): current is DragState {
  return current !== null && current.pointerId === (e.pointerId ?? 0);
}

export interface PointerGestureOptions {
  dimensions: WordSearchDimensions;
  /** The press in progress; useSelection clears it on cancel and give-up. */
  drag: MutableRef<DragState | null>;
  /** The selection as it stands now, read when a press starts. */
  snapshot: () => Snapshot;
  restore: (before: Snapshot) => void;
  focusCell: (cell: CellCoord) => void;
  setHover: (cell: CellCoord | null) => void;
  setAnchor: (cell: CellCoord | null) => void;
  clearCheck: () => void;
  finish: (start: CellCoord, end: CellCoord) => void;
  tap: (target: CellCoord, prior: CellCoord | null) => void;
  cancel: () => void;
}

/**
 * Pointer handlers for the grid, with positions in cell units. One pointer
 * owns a press from down to up; a press is a tap until it travels half a
 * cell, then a straight drag from the cell where it went down.
 */
export function usePointerGesture(options: PointerGestureOptions) {
  const { dimensions, drag, snapshot, restore, focusCell, setHover, setAnchor, clearCheck, finish, tap, cancel } = options;

  const handleCellPointerDown = useCallback((row: number, col: number, pointerId = 0) => {
    // A second finger while the first one is down does not take over.
    if (drag.current && drag.current.pointerId !== pointerId) return;
    const origin = { row, col };
    const cell = nearestCell(origin, dimensions);
    const before = snapshot();
    drag.current = { pointerId, origin, down: cell, before, moved: false };
    clearCheck();
    focusCell(cell);
    if (before.anchor) setHover(cell);
    else setAnchor(cell);
  }, [clearCheck, dimensions, drag, focusCell, setAnchor, setHover, snapshot]);

  /** The pointer moved to a position in cell units, pressed or not. */
  const handleCellPointerEnter = useCallback((row: number, col: number, pointerId = 0) => {
    const position = { row, col };
    const current = drag.current;
    if (!current) {
      if (!snapshot().anchor) return;
      const cell = nearestCell(position, dimensions);
      focusCell(cell);
      setHover(cell);
      return;
    }
    const end = current.pointerId === pointerId ? dragEnd(current, position, dimensions) : null;
    if (!end) return;
    if (!current.moved) {
      // A drag starts its own line, even with a start marked by a tap.
      current.moved = true;
      setAnchor(current.down);
    }
    focusCell(end);
    setHover(end);
  }, [dimensions, drag, focusCell, setAnchor, setHover, snapshot]);

  const handleCellPointerUp = useCallback((row: number, col: number, pointerId = 0) => {
    const current = drag.current;
    if (!current || current.pointerId !== pointerId) return;
    drag.current = null;
    const end = dragEnd(current, { row, col }, dimensions);
    if (end) finish(current.down, end);
    else tap(current.down, current.before.anchor);
  }, [dimensions, drag, finish, tap]);

  // A drag that ends off the grid stops at the last cell it reached; a
  // gesture the browser takes over drops the selection, and a press it
  // takes over before any drag leaves the selection as it was.
  useEffect(() => {
    const release = (e: PointerEvent) => {
      const current = drag.current;
      if (!owns(current, e)) return;
      drag.current = null;
      if (current.moved) finish(current.down, snapshot().hover ?? current.down);
    };
    const abort = (e: PointerEvent) => {
      const current = drag.current;
      if (!owns(current, e)) return;
      drag.current = null;
      if (current.moved) cancel();
      else restore(current.before);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", abort);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", abort);
    };
  }, [cancel, drag, finish, restore, snapshot]);

  return { handleCellPointerDown, handleCellPointerEnter, handleCellPointerUp };
}
