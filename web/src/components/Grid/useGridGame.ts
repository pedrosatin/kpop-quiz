import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyMatchRecorded } from "../../lib/player-stats";
import { gridMatchId, isGridWin } from "./useRecordGridMatch";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { CandidateEntity, IntersectionGrid, Locale } from "../../lib/quiz-types";
import { buildLocalizedDisplayNames } from "../../lib/display-name";
import { GridArtifactError, loadIntersectionGrid } from "../../data/grid-loader";
import {
  cellKey,
  type CellCoordinates,
  type GridCellState,
  type GridGameStatus,
  type GridStoredCell,
  type GridStoredState,
} from "./types";

const MAX_GUESSES = 9;

function gridStorageKey(grid: IntersectionGrid): string {
  return `kpop-grid-${grid.grid_id}`;
}

function countSolved(cells: Record<string, GridStoredCell>): number {
  return Object.values(cells).filter((c) => c.solved).length;
}

function displayNamesFor(grid: IntersectionGrid, locale: Locale): Map<string, string> {
  return buildLocalizedDisplayNames(grid.candidate_pool, locale);
}

function candidateName(
  grid: IntersectionGrid,
  id: string,
  locale: Locale,
  names?: Map<string, string>,
): string | undefined {
  return (names ?? displayNamesFor(grid, locale)).get(id);
}

/** Adds the names of the saved QIDs in the page's language. */
function nameCells(
  cells: Record<string, GridStoredCell>,
  grid: IntersectionGrid | null,
  locale: Locale,
): Record<string, GridCellState> {
  const names = grid ? displayNamesFor(grid, locale) : undefined;
  const named: Record<string, GridCellState> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const state: GridCellState = { ...cell };
    if (grid && cell.entityId) state.entityName = candidateName(grid, cell.entityId, locale, names) ?? cell.entityId;
    if (grid && cell.lastAttemptId) {
      state.lastAttempt = candidateName(grid, cell.lastAttemptId, locale, names) ?? cell.lastAttemptId;
    }
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
function loadSavedGrid(grid: IntersectionGrid): GridStoredState | null {
  let saved: unknown;
  try {
    const raw = localStorage.getItem(gridStorageKey(grid));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const { guessesUsed, cells, gaveUp } = saved as Partial<GridStoredState>;
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
      const tried = restoreTried(state, pool);
      if (!tried) return null;
      const id = state.lastAttemptId;
      restored[key] = {
        solved: false,
        failed: true,
        ...(id ? { lastAttemptId: id } : {}),
        ...(tried.length > 0 ? { triedIds: tried } : {}),
      };
      touched += Math.max(1, tried.length);
    }
  }
  // Every right group and every wrong group tried took a guess.
  if (touched > (guessesUsed as number)) return null;
  return { guessesUsed: guessesUsed as number, cells: restored, ...(gaveUp === true ? { gaveUp: true as const } : {}) };
}

/**
 * The wrong groups a saved failed cell tried, without repeats, or null when
 * one is not a pool QID. A save from before `triedIds` has only the last
 * one, which then counts as the one group tried.
 */
function restoreTried(state: Partial<GridStoredCell>, pool: Set<string>): string[] | null {
  const last: unknown = state.lastAttemptId;
  const tried: unknown = state.triedIds ?? [];
  if (last !== undefined && (typeof last !== "string" || !pool.has(last))) return null;
  if (!Array.isArray(tried) || tried.some((id) => typeof id !== "string" || !pool.has(id))) return null;
  const ids = new Set<string>(tried as string[]);
  if (last) ids.add(last);
  return [...ids];
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

// The picker is open while a cell is selected during play; the selection is
// the only record of it.
function pickerStatus(status: GridGameStatus, selectedCell: CellCoordinates | null): GridGameStatus {
  return status === "ready" && selectedCell ? "cell_selected" : status;
}

function canSelectCell(status: GridGameStatus, cell: GridStoredCell | undefined): boolean {
  return status === "ready" && !cell?.solved;
}

function restoreGame(grid: IntersectionGrid) {
  const saved = loadSavedGrid(grid);
  const cells = saved?.cells ?? createEmptyCells();
  const guesses = saved?.guessesUsed ?? 0;
  const gaveUp = saved?.gaveUp === true;
  const usedIds = new Set(Object.values(cells).flatMap((cell) => cell.solved && cell.entityId ? [cell.entityId] : []));
  const status: GridGameStatus = isFinished(cells, guesses) || gaveUp ? "complete" : "ready";
  return { cells, guesses, gaveUp, usedIds, status };
}

export function useGridGame(locale: Locale, baseUrl?: string) {
  const [corrected, setCorrected] = useState(false);
  const [grid, setGrid] = useState<IntersectionGrid | null>(null);
  const [status, setStatus] = useState<GridGameStatus>("loading");
  const [errorKind, setErrorKind] = useState<"missing" | "invalid" | undefined>();
  const [selectedCell, setSelectedCell] = useState<CellCoordinates | null>(null);
  const [guessesUsed, setGuessesUsed] = useState<number>(0);
  const [gaveUp, setGaveUp] = useState<boolean>(false);
  // QIDs only; `cells` below adds the names in the page's language.
  const [storedCells, setCells] = useState<Record<string, GridStoredCell>>(createEmptyCells);
  const [usedEntityIds, setUsedEntityIds] = useState<Set<string>>(new Set());
  const [uniquenessError, setUniquenessError] = useState<string | null>(null);

  const analytics = useGameAnalytics(
    {
      game: "grid",
      locale,
      isDaily: () => grid !== null && !isDailyMatchRecorded("grid", grid.reference_date, gridMatchId(grid)),
      outcome: status !== "complete" ? null : gaveUp ? "give_up" : isGridWin(countSolved(storedCells)) ? "win" : "loss",
    },
    status === "complete",
    guessesUsed > 0,
  );

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadIntersectionGrid(locale, baseUrl);
      setCorrected(data.corrected);
      const restored = restoreGame(data);
      setCells(restored.cells);
      setGuessesUsed(restored.guesses);
      setGaveUp(restored.gaveUp);
      setUsedEntityIds(restored.usedIds);
      setSelectedCell(null);
      setUniquenessError(null);
      setGrid(data);
      setStatus(restored.status);
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
  // untouched board is not saved: loading a grid writes nothing. A give-up
  // is saved even with zero guesses, so the result survives a reload.
  useEffect(() => {
    if (!grid || status === "loading" || status === "error" || (guessesUsed === 0 && !gaveUp)) return;
    try {
      const state: GridStoredState = { guessesUsed, cells: storedCells, ...(gaveUp ? { gaveUp: true as const } : {}) };
      localStorage.setItem(gridStorageKey(grid), JSON.stringify(state));
    } catch {}
  }, [grid, status, guessesUsed, gaveUp, storedCells]);

  const selectCell = useCallback((row: number, col: number) => {
    if (!canSelectCell(status, storedCells[cellKey(row, col)])) return;
    setSelectedCell({ row, col });
    setUniquenessError(null);
  }, [storedCells, status]);

  const closePicker = useCallback(() => {
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus("ready");
  }, []);

  const makeGuess = useCallback((candidate: CandidateEntity) => {
    if (!selectedCell || !grid) return { success: false, reason: "no_selection" as const };

    const names = displayNamesFor(grid, locale);
    const displayName = names.get(candidate.id) || candidate.canonical_name;

    if (usedEntityIds.has(candidate.id)) {
      setUniquenessError(displayName);
      return { success: false, reason: "already_used" as const };
    }

    // A group already refused in this cell costs nothing: the owner closes
    // the picker and says so.
    const key = cellKey(selectedCell.row, selectedCell.col);
    const tried = storedCells[key]?.triedIds ?? [];
    if (tried.includes(candidate.id)) {
      return {
        success: false,
        reason: "already_tried" as const,
        row: selectedCell.row,
        col: selectedCell.col,
        name: displayName,
      };
    }

    analytics.start();
    const targetCell = grid.cells.find(
      (c) => c.row_index === selectedCell.row && c.col_index === selectedCell.col
    );
    const isCorrect = targetCell ? targetCell.valid_entity_ids.includes(candidate.id) : false;
    const newGuesses = guessesUsed + 1;

    const updatedCells = { ...storedCells };
    const newUsed = new Set(usedEntityIds);

    if (isCorrect) {
      updatedCells[key] = { solved: true, failed: false, entityId: candidate.id };
      newUsed.add(candidate.id);
    } else {
      updatedCells[key] = { solved: false, failed: true, lastAttemptId: candidate.id, triedIds: [...tried, candidate.id] };
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

  const giveUp = useCallback(() => {
    if (!grid || status === "complete") return;
    analytics.start();
    setSelectedCell(null);
    setUniquenessError(null);
    setGaveUp(true);
    setStatus("complete");
  }, [grid, status]);

  const restartGame = useCallback(() => {
    analytics.reset();
    if (grid) {
      try {
        localStorage.removeItem(gridStorageKey(grid));
      } catch {}
    }
    setCells(createEmptyCells());
    setUsedEntityIds(new Set());
    setGuessesUsed(0);
    setGaveUp(false);
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus("ready");
  }, [grid]);

  return {
    corrected,
    grid,
    status: pickerStatus(status, selectedCell),
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
    giveUp,
    gaveUp,
    restartGame,
    reload: loadData,
  };
}
