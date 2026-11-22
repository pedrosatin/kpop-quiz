import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StrandsDimensions } from "../../lib/strands-types";
import { nearestCell } from "../WordSearch/geometry";
import { extendTrail, pathLetters, sameCell } from "./trail";
import type { CellCoord, TrailCheck, TrailVerdict } from "./types";

const DIALOG = '[role="dialog"], [aria-modal="true"]';
const OWN_MODAL = '.modal-card[aria-modal="true"]';

function dialogOwnsEscape(target: EventTarget | null): boolean {
  const inside = (target as Element | null)?.closest?.(DIALOG);
  return Boolean(inside ?? document.querySelector(OWN_MODAL));
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

export interface StrandsTrailOptions {
  dimensions: StrandsDimensions;
  grid: string[][];
  playing: boolean;
  judge: (path: CellCoord[]) => TrailVerdict | null;
}

/**
 * Continuous trail selection: eight neighbours, undo by revisiting the
 * previous cell, no reuse in the same trail. Drag confirms on release;
 * a simple tap only extends the trail (Confirm / Enter submit it).
 */
export function useStrandsTrail({ dimensions, grid, playing, judge }: StrandsTrailOptions) {
  const [focusedCell, setFocusedCell] = useState<CellCoord>({ row: 0, col: 0 });
  const [path, setPath] = useState<CellCoord[]>([]);
  const [lastCheck, setLastCheck] = useState<TrailCheck | null>(null);
  const checkCount = useRef(0);

  const focusedRef = useRef(focusedCell);
  focusedRef.current = focusedCell;
  const pathRef = useRef(path);
  pathRef.current = path;
  const dragPointer = useRef<number | null>(null);
  const gestureStart = useRef<CellCoord | null>(null);
  const draggedBeyondStart = useRef(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const report = useCallback((verdict: TrailVerdict) => {
    setLastCheck({ ...verdict, n: ++checkCount.current });
  }, []);

  const focusCell = useCallback((cell: CellCoord) => {
    focusedRef.current = cell;
    setFocusedCell(cell);
  }, []);

  const setTrail = useCallback((next: CellCoord[]) => {
    pathRef.current = next;
    setPath(next);
  }, []);

  const clear = useCallback(() => {
    dragPointer.current = null;
    gestureStart.current = null;
    draggedBeyondStart.current = false;
    setTrail([]);
  }, [setTrail]);

  const cancel = useCallback(() => {
    if (pathRef.current.length === 0) return;
    clear();
    report({ kind: "cancelled" });
  }, [clear, report]);

  const confirm = useCallback(() => {
    const current = pathRef.current;
    if (current.length === 0) return;
    const verdict = judge(current);
    if (verdict) report(verdict);
    clear();
  }, [clear, judge, report]);

  const markOrExtend = useCallback((cell: CellCoord) => {
    const next = extendTrail(pathRef.current, cell);
    setTrail(next);
    focusCell(cell);
    setLastCheck(null);
  }, [focusCell, setTrail]);

  const handleCellPointerDown = useCallback((row: number, col: number, pointerId = 0) => {
    if (!playingRef.current) return;
    if (dragPointer.current !== null && dragPointer.current !== pointerId) return;
    const cell = nearestCell({ row, col }, dimensions);
    dragPointer.current = pointerId;
    gestureStart.current = cell;
    draggedBeyondStart.current = false;
    setLastCheck(null);
    if (pathRef.current.length === 0) {
      setTrail([cell]);
    } else {
      setTrail(extendTrail(pathRef.current, cell));
    }
    focusCell(cell);
  }, [dimensions, focusCell, setTrail]);

  const handleCellPointerEnter = useCallback((row: number, col: number, pointerId = 0) => {
    if (!playingRef.current) return;
    if (dragPointer.current === null || dragPointer.current !== pointerId) return;
    const cell = nearestCell({ row, col }, dimensions);
    if (gestureStart.current && !sameCell(gestureStart.current, cell)) {
      draggedBeyondStart.current = true;
    }
    const next = extendTrail(pathRef.current, cell);
    if (next.length !== pathRef.current.length || !sameCell(next[next.length - 1], pathRef.current[pathRef.current.length - 1])) {
      setTrail(next);
    }
    focusCell(cell);
  }, [dimensions, focusCell, setTrail]);

  const handleCellPointerUp = useCallback((_row: number, _col: number, pointerId = 0) => {
    if (dragPointer.current !== pointerId) return;
    const wasDrag = draggedBeyondStart.current;
    dragPointer.current = null;
    gestureStart.current = null;
    draggedBeyondStart.current = false;
    if (!playingRef.current) return;
    if (wasDrag) confirm();
  }, [confirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dialogOwnsEscape(e.target)) return;
      if (pathRef.current.length > 0 && playingRef.current) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!playingRef.current) return;

    if (e.key === " ") {
      e.preventDefault();
      markOrExtend(focusedRef.current);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
      return;
    }
    if (e.key === "Escape") {
      if (pathRef.current.length > 0) {
        e.preventDefault();
        cancel();
      }
      return;
    }

    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    const next = {
      row: clamp(focusedRef.current.row + move[0], dimensions.rows),
      col: clamp(focusedRef.current.col + move[1], dimensions.cols),
    };
    focusCell(next);
    if (pathRef.current.length > 0) {
      setTrail(extendTrail(pathRef.current, next));
    }
  }, [cancel, confirm, dimensions, focusCell, markOrExtend, setTrail]);

  const activeLetters = pathLetters(grid, path);

  return {
    focusedCell,
    path,
    activeLetters,
    lastCheck,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
    clear,
    cancel,
    confirm,
  };
}
