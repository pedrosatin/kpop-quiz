import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { WordSearchDimensions } from "../../lib/word-search-types";
import type { CellCoord, SelectionCheck } from "./types";
import { sameCell } from "./geometry";
import { handleWordSearchKeyDown } from "./keyboard";
import { resolveTap, type SelectionVerdict } from "./selection";
import { usePointerGesture, type DragState, type Snapshot } from "./usePointerGesture";

type Report = SelectionVerdict | { kind: "offline"; from: string } | { kind: "cancelled" };

/** Dialogs that take Esc for themselves. */
const DIALOG = '[role="dialog"], [aria-modal="true"]';
/**
 * The site's own modals (confirmation, statistics). Only these count while
 * focus is elsewhere: a third-party script may leave a hidden aria-modal
 * node in the page, and that must not swallow Esc on the grid.
 */
const OWN_MODAL = '.modal-card[aria-modal="true"]';

/**
 * Esc pressed in a dialog, or while one of the site's modals is open,
 * belongs to the dialog: its own listener may run after this one, and focus
 * reaches it a moment after it opens.
 */
function dialogOwnsEscape(target: EventTarget | null): boolean {
  const inside = (target as Element | null)?.closest?.(DIALOG);
  return Boolean(inside ?? document.querySelector(OWN_MODAL));
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
  const [lastCheck, setCheckState] = useState<SelectionCheck | null>(null);
  const checkCount = useRef(0);
  const checkRef = useRef<SelectionCheck | null>(lastCheck);
  checkRef.current = lastCheck;

  const focusedRef = useRef<CellCoord>(focusedCell);
  focusedRef.current = focusedCell;
  const anchorRef = useRef<CellCoord | null>(anchorCell);
  anchorRef.current = anchorCell;
  const hoverRef = useRef<CellCoord | null>(currentHoverCell);
  hoverRef.current = currentHoverCell;
  const drag = useRef<DragState | null>(null);

  const setLastCheck = useCallback((check: SelectionCheck | null) => {
    checkRef.current = check;
    setCheckState(check);
  }, []);

  const report = useCallback((check: Report) => {
    setLastCheck({ ...check, n: ++checkCount.current } as SelectionCheck);
  }, [setLastCheck]);

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
  }, [cancel, finish, grid, report, setAnchor, setLastCheck]);

  const snapshot = useCallback((): Snapshot => ({
    anchor: anchorRef.current,
    hover: hoverRef.current,
    focus: focusedRef.current,
    check: checkRef.current,
  }), []);

  const restore = useCallback((before: Snapshot) => {
    setAnchor(before.anchor);
    setHover(before.hover);
    focusCell(before.focus);
    setLastCheck(before.check);
  }, [focusCell, setAnchor, setHover, setLastCheck]);

  const clearCheck = useCallback(() => setLastCheck(null), [setLastCheck]);

  const pointer = usePointerGesture({
    dimensions,
    drag,
    snapshot,
    restore,
    focusCell,
    setHover,
    setAnchor,
    clearCheck,
    finish,
    tap,
    cancel,
  });

  // Esc cancels a marked start wherever the focus is: a tap does not move
  // focus into the grid. An open dialog keeps its Esc. The listener stays on
  // and reads refs, so an Esc pressed right after the start is drawn, before
  // effects run, still finds the start.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dialogOwnsEscape(e.target)) return;
      if (anchorRef.current && playingRef.current) cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    ...pointer,
    handleKeyDown,
    clear,
  };
}
