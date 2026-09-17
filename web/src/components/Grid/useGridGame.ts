import { useCallback, useEffect, useState } from "preact/hooks";
import type { CandidateEntity, IntersectionGrid, Locale } from "../../lib/quiz-types";
import { GridArtifactError, loadIntersectionGrid } from "../../data/grid-loader";
import { cellKey, type CellCoordinates, type GridCellState, type GridGameStatus } from "./types";

export const MAX_GUESSES = 9;

function createEmptyCells(): Record<string, GridCellState> {
  const cells: Record<string, GridCellState> = {};
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
  const [cells, setCells] = useState<Record<string, GridCellState>>(createEmptyCells);
  const [usedEntityIds, setUsedEntityIds] = useState<Set<string>>(new Set());
  const [uniquenessError, setUniquenessError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorKind(undefined);
    try {
      const data = await loadIntersectionGrid(locale, baseUrl);
      setGrid(data);
      setStatus("ready");
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

  const selectCell = useCallback((row: number, col: number) => {
    const key = cellKey(row, col);
    if (cells[key]?.solved) return;
    setSelectedCell({ row, col });
    setUniquenessError(null);
    setStatus("cell_selected");
  }, [cells]);

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

    const updatedCells = { ...cells };
    const newUsed = new Set(usedEntityIds);

    const displayName = candidate.names[locale] || candidate.canonical_name;

    if (isCorrect) {
      updatedCells[key] = {
        solved: true,
        failed: false,
        entityId: candidate.id,
        entityName: displayName,
      };
      newUsed.add(candidate.id);
    } else {
      updatedCells[key] = {
        solved: false,
        failed: true,
        lastAttempt: displayName,
      };
    }

    const solvedCount = Object.values(updatedCells).filter((c) => c.solved).length;
    const isFinished = solvedCount === 9 || newGuesses >= MAX_GUESSES;

    setCells(updatedCells);
    setUsedEntityIds(newUsed);
    setGuessesUsed(newGuesses);
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus(isFinished ? "complete" : "ready");

    return { success: isCorrect, reason: isCorrect ? ("correct" as const) : ("incorrect" as const) };
  }, [selectedCell, grid, usedEntityIds, locale, guessesUsed, cells]);

  const restartGame = useCallback(() => {
    setCells(createEmptyCells());
    setUsedEntityIds(new Set());
    setGuessesUsed(0);
    setSelectedCell(null);
    setUniquenessError(null);
    setStatus("ready");
  }, []);

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
