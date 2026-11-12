import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchDimensions } from "../../lib/word-search-types";
import type { CellCoord, SelectionCheck } from "./types";
import { nearestCell, sameCell, snapToLine } from "./geometry";
import { handleWordSearchKeyDown } from "./keyboard";
import { resolveTap, type SelectionVerdict } from "./selection";

type Report = SelectionVerdict | { kind: "offline"; from: string } | { kind: "cancelled" };

interface DragState {
  /** Cell where the pointer went down: the start of a drag. */
  down: CellCoord;
  /** Start marked by an earlier tap, for a press that turns out to be a tap. */
  priorAnchor: CellCoord | null;
  moved: boolean;
}

export interface SelectionOptions {
  dimensions: WordSearchDimensions;
  grid: string[][];
  playing: boolean;
  /** Scores a straight selection; null when there is nothing to say. */
  judge: (start: CellCoord, end: CellCoord) => SelectionVerdict | null;
}

/**
 * The selection on the grid: the start marked by a tap or Enter, the line
 * dragged from it, and the verdict of the last selection for the bar.
 *
 * Pointer positions are in cell units and may fall between cells (see
 * geometry.ts). A tap takes the nearest cell; a drag keeps a straight line
 * from the cell where it began. Keys and pointers can arrive faster than
 * re-renders, so handlers read and write refs, not the values of the last
 * render.
 */
export function useSelection({ dimensions, grid, playing, judge }: SelectionOptions) {
  const [focusedCell, setFocusedCell] = useState<CellCoord>({ row: 0, col: 0 });
  const [anchorCell, setAnchorState] = useState<CellCoord | null>(null);
  const [currentHoverCell, setHoverState] = useState<CellCoord | null>(null);
  // Verdict of the last selection, cleared when the next one starts.
  const [lastCheck, setLastCheck] = useState<SelectionCheck | null>(null);
  const checkCount = useRef(0);

  const focusedRef = useRef<CellCoord>(focusedCell);
  focusedRef.current = focusedCell;
  const anchorRef = useRef<CellCoord | null>(anchorCell);
  anchorRef.current = anchorCell;
  const hoverRef = useRef<CellCoord | null>(currentHoverCell);
  hoverRef.current = currentHoverCell;
  const drag = useRef<DragState | null>(null);

  const report = useCallback((check: Report) => {
    setLastCheck({ ...check, n: ++checkCount.current } as SelectionCheck);
  }, []);

  const focusCell = useCallback((cell: CellCoord) => {
    focusedRef.current = cell;
    setFocusedCell(cell);
  }, []);

  const setHover = useCallback((cell: CellCoord | null) => {
    hoverRef.current = cell;
    setHoverState(cell);
  }, []);

  const setAnchor = useCallback((cell: CellCoord | null) => {
    anchorRef.current = cell;
    setAnchorState(cell);
    setHover(cell);
  }, [setHover]);

  /** Drops the selection without a word, as giving up does. */
  const clear = useCallback(() => {
    drag.current = null;
    setAnchor(null);
  }, [setAnchor]);

  const cancel = useCallback(() => {
    drag.current = null;
    if (!anchorRef.current) return;
    setAnchor(null);
    report({ kind: "cancelled" });
  }, [report, setAnchor]);

  const finish = useCallback((start: CellCoord, end: CellCoord) => {
    if (sameCell(start, end)) {
      cancel();
      return;
    }
    const verdict = judge(start, end);
    if (verdict) report(verdict);
    setAnchor(null);
  }, [cancel, judge, report, setAnchor]);

  const tap = useCallback((target: CellCoord, prior: CellCoord | null) => {
    const action = resolveTap(prior, target);
    if (action === "cancel") cancel();
    else if (action === "check") finish(prior!, target);
    else {
      if (action === "offline") report({ kind: "offline", from: grid[prior!.row]?.[prior!.col] ?? "" });
      else setLastCheck(null);
      setAnchor(target);
    }
  }, [cancel, finish, grid, report, setAnchor]);

  const handleCellPointerDown = useCallback((row: number, col: number) => {
    const cell = { row, col };
    drag.current = { down: cell, priorAnchor: anchorRef.current, moved: false };
    setLastCheck(null);
    focusCell(cell);
    if (anchorRef.current) setHover(cell);
    else setAnchor(cell);
  }, [focusCell, setAnchor, setHover]);

  /** The pointer moved to a position in cell units, pressed or not. */
  const handleCellPointerEnter = useCallback((row: number, col: number) => {
    const position = { row, col };
    const current = drag.current;
    if (!current) {
      if (!anchorRef.current) return;
      const cell = nearestCell(position, dimensions);
      focusCell(cell);
      setHover(cell);
      return;
    }
    const end = snapToLine(current.down, position, dimensions);
    if (!current.moved && sameCell(end, current.down)) return;
    if (!current.moved) {
      // A drag starts its own line, even with a start marked by a tap.
      current.moved = true;
      setAnchor(current.down);
    }
    focusCell(end);
    setHover(end);
  }, [dimensions, focusCell, setAnchor, setHover]);

  const handleCellPointerUp = useCallback((row: number, col: number) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const position = { row, col };
    const target = nearestCell(position, dimensions);
    if (current.moved || !sameCell(target, current.down)) {
      finish(current.down, snapToLine(current.down, position, dimensions));
    } else {
      tap(target, current.priorAnchor);
    }
  }, [dimensions, finish, tap]);

  // A drag that ends off the grid stops at the last cell it reached; a
  // gesture the browser takes over drops the selection.
  useEffect(() => {
    const release = () => {
      const current = drag.current;
      drag.current = null;
      if (current?.moved) finish(current.down, hoverRef.current ?? current.down);
    };
    const abort = () => {
      if (drag.current?.moved) cancel();
      drag.current = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", abort);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", abort);
    };
  }, [cancel, finish]);

  // Esc cancels a marked start wherever the focus is: a tap does not move
  // focus into the grid.
  useEffect(() => {
    if (!anchorCell || !playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchorCell, playing, cancel]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    handleWordSearchKeyDown(e, {
      focusedCell: focusedRef.current,
      anchorCell: anchorRef.current,
      dimensions,
      setFocusedCell: focusCell,
      setCurrentHoverCell: setHover,
      tap: (cell) => tap(cell, anchorRef.current),
      cancel,
    });
  }, [dimensions, focusCell, setHover, tap, cancel]);

  return {
    focusedCell,
    setFocusedCell: focusCell,
    anchorCell,
    currentHoverCell,
    lastCheck,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
    clear,
  };
}
