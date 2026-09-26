import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { CandidateEntity, IntersectionGrid, Locale } from "../../lib/quiz-types";
import { GridArtifactError, loadIntersectionGrid } from "../../data/grid-loader";
import {
  cellKey,
  type CellCoordinates,
  type GridCellState,
  type GridGameStatus,
  type GridStoredCell,
  type GridStoredState,
} from "./types";

export const MAX_GUESSES = 9;

export function gridStorageKey(grid: IntersectionGrid): string {
  return `kpop-grid-${grid.grid_id}`;
}

function countSolved(cells: Record<string, GridStoredCell>): number {
  return Object.values(cells).filter((c) => c.solved).length;
}

function candidateName(grid: IntersectionGrid, id: string, locale: Locale): string | undefined {
  const candidate = grid.candidate_pool.find((c) => c.id === id);
  return candidate ? candidate.names[locale] || candidate.canonical_name : undefined;
}

/** Adds the names of the saved QIDs in the page's language. */
export function nameCells(
  cells: Record<string, GridStoredCell>,
  grid: IntersectionGrid | null,
  locale: Locale,
): Record<string, GridCellState> {
  const named: Record<string, GridCellState> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const state: GridCellState = { ...cell };
    if (grid && cell.entityId) state.entityName = candidateName(grid, cell.entityId, locale) ?? cell.entityId;
    if (grid && cell.lastAttemptId) state.lastAttempt = candidateName(grid, cell.lastAttemptId, locale) ?? cell.lastAttemptId;
    named[key] = state;
  }
  return named;
}

/**
 * Reads a saved game of this grid (format in GridStoredState). A save that
 * names a group the cell does not accept, a group outside the pool, uses a
 * group twice or counts more guesses than allowed is dropped, so a stale or
 * edited save never shows a board the player did not reach.
 */
export function loadSavedGrid(grid: IntersectionGrid): GridStoredState | null {
  let saved: unknown;
  try {
    const raw = localStorage.getItem(gridStorageKey(grid));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const { guessesUsed, cells } = saved as Partial<GridStoredState>;
  if (!Number.isInteger(guessesUsed) || (guessesUsed as number) < 0 || (guessesUsed as number) > MAX_GUESSES) return null;
  if (typeof cells !== "object" || cells === null) return null;

  const pool = new Set(grid.candidate_pool.map((c) => c.id));
  const restored = createEmptyCells();
  const used = new Set<string>();
  let touched = 0;
  for (const cell of grid.cells) {
    const key = cellKey(cell.row_index, cell.col_index);
    const state = (cells as Record<string, unknown>)[key] as Partial<GridStoredCell> | undefined;
    if (typeof state !== "object" || state === null) return null;
    if (state.solved === true) {
      const id = state.entityId;
      if (typeof id !== "string" || !pool.has(id) || !cell.valid_entity_ids.includes(id) || used.has(id)) return null;
      used.add(id);
      restored[key] = { solved: true, failed: false, entityId: id };
      touched++;
    } else if (state.failed === true) {
      const id = state.lastAttemptId;
      if (id !== undefined && (typeof id !== "string" || !pool.has(id))) return null;
      restored[key] = { solved: false, failed: true, ...(id ? { lastAttemptId: id } : {}) };
      touched++;
    }
  }
  // Every cell with a group took at least one guess.
  if (touched > (guessesUsed as number)) return null;
  return { guessesUsed: guessesUsed as number, cells: restored };
}

function isFinished(cells: Record<string, GridStoredCell>, guessesUsed: number): boolean {
  return countSolved(cells) === 9 || guessesUsed >= MAX_GUESSES;
}

function createEmptyCells(): Record<string, GridStoredCell> {
  const cells: Record<string, GridStoredCell> = {};
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells[cellKey(r, c)] = { solved: false, failed: false };
    }
  }
  return cells;
}

export function useGridGame(locale: Locale, baseUrl?: string) {
  const [grid, setGrid] = useState<IntersectionGrid | null>(null);
  const [status, setStatus] = useState<GridGameStatus>("loading");
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();
  const [selectedCell, setSelectedCell] = useState<CellCoordinates | null>(null);
  const [guessesUsed, setGuessesUsed] = useState<number>(0);
  // QIDs only; `cells` below adds the names in the page's language.
  const [storedCells, setCells] = useState<Record<string, GridStoredCell>>(createEmptyCells);
  const [usedEntityIds, setUsedEntityIds] = useState<Set<string>>(new Set());
  const [uniquenessError, setUniquenessError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadIntersectionGrid(locale, baseUrl);
      const saved = loadSavedGrid(data);
      const restoredCells = saved?.cells ?? createEmptyCells();
      const restoredGuesses = saved?.guessesUsed ?? 0;
      setCells(restoredCells);
      setGuessesUsed(restoredGuesses);
      setUsedEntityIds(new Set(Object.values(restoredCells).flatMap((c) => (c.solved && c.entityId ? [c.entityId] : []))));
      setSelectedCell(null);
      setUniquenessError(null);
      setGrid(data);
      setStatus(isFinished(restoredCells, restoredGuesses) ? "complete" : "ready");
    } catch (err) {
      if (err instanceof GridArtifactError) {
        setErrorKind(err.kind);
      } else {
        setErrorKind("invalid");
      }
      setStatus("error");
    }
  }, [locale, baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const cells = useMemo(() => nameCells(storedCells, grid, locale), [storedCells, grid, locale]);

  // Save after every guess, so a reload keeps the board and the result. An
  // untouched board is not saved: loading a grid writes nothing.
  useEffect(() => {
    if (!grid || status === "loading" || status === "error" || guessesUsed === 0) return;
    try {
      const state: GridStoredState = { guessesUsed, cells: storedCells };
      localStorage.setItem(gridStorageKey(grid), JSON.stringify(state));
    } catch {}
  }, [grid, status, guessesUsed, storedCells]);

  const selectCell = useCallback((row: number, col: number) => {
    const key = cellKey(row, col);
    if (storedCells[key]?.solved) return;
    setSelectedCell({ row, col });
    setUniquenessError(null);
    setStatus("cell_selected");
  }, [storedCells]);

  const closePicker = useCallback(() => {
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus("ready");
  }, []);

  const makeGuess = useCallback((candidate: CandidateEntity) => {
    if (!selectedCell || !grid) return { success: false, reason: "no_selection" as const };

    if (usedEntityIds.has(candidate.id)) {
      const name = candidate.names[locale] || candidate.canonical_name;
      setUniquenessError(name);
      return { success: false, reason: "already_used" as const };
    }

    const targetCell = grid.cells.find(
      (c) => c.row_index === selectedCell.row && c.col_index === selectedCell.col
    );
    const isCorrect = targetCell ? targetCell.valid_entity_ids.includes(candidate.id) : false;
    const newGuesses = guessesUsed + 1;
    const key = cellKey(selectedCell.row, selectedCell.col);

    const updatedCells = { ...storedCells };
    const newUsed = new Set(usedEntityIds);

    const displayName = candidate.names[locale] || candidate.canonical_name;

    if (isCorrect) {
      updatedCells[key] = { solved: true, failed: false, entityId: candidate.id };
      newUsed.add(candidate.id);
    } else {
      updatedCells[key] = { solved: false, failed: true, lastAttemptId: candidate.id };
    }

    const finished = isFinished(updatedCells, newGuesses);

    setCells(updatedCells);
    setUsedEntityIds(newUsed);
    setGuessesUsed(newGuesses);
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus(finished ? "complete" : "ready");

    return {
      success: isCorrect,
      reason: isCorrect ? ("correct" as const) : ("incorrect" as const),
      row: selectedCell.row,
      col: selectedCell.col,
      name: displayName,
      cells: updatedCells,
      finished,
    };
  }, [selectedCell, grid, usedEntityIds, locale, guessesUsed, storedCells]);

  const restartGame = useCallback(() => {
    if (grid) {
      try {
        localStorage.removeItem(gridStorageKey(grid));
      } catch {}
    }
    setCells(createEmptyCells());
    setUsedEntityIds(new Set());
    setGuessesUsed(0);
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus("ready");
  }, [grid]);

  return {
    grid,
    status,
    errorKind,
    selectedCell,
    guessesUsed,
    maxGuesses: MAX_GUESSES,
    cells,
    usedEntityIds,
    uniquenessError,
    selectCell,
    closePicker,
    makeGuess,
    restartGame,
    reload: loadData,
  };
}
