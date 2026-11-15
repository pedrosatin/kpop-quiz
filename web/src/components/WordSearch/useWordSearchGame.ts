import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyBoardRound } from "../../lib/player-stats";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord, GameStatus } from "./types";
import { getLinearPath } from "./utils";
import { loadStoredProgress, storeProgress, wordSearchStorageKey } from "./word-search-save";
import { foundCellColors, revealedCellKeys, roundOutcome, selectionPath } from "./word-search-state";
import { judgeSelection } from "./selection";
import { useSelection } from "./useSelection";
import type { Locale } from "../../lib/quiz-types";

export function wordSearchMatchId(puzzle: WordSearchPuzzle): string {
  return `word-search-${puzzle.puzzle_id}`;
}

function ignoreInput(): void {}

// A finished board ignores pointer and key input; while it is in play the
// handler keeps its identity between renders.
function whilePlaying<A extends unknown[]>(status: GameStatus, handler: (...args: A) => void): (...args: A) => void {
  return status === "in_progress" ? handler : ignoreInput;
}

export function useWordSearchGame(puzzle: WordSearchPuzzle, locale: Locale) {
  const storageKey = wordSearchStorageKey(puzzle.puzzle_id);

  const initial = useMemo(() => loadStoredProgress(storageKey, new Set(puzzle.words.map((word) => word.id))), [storageKey, puzzle]);
  const [foundWordIds, setFoundWordIds] = useState<string[]>(initial.foundWordIds);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(initial.elapsedSeconds);
  const [status, setStatus] = useState<GameStatus>(initial.status);
  const [easyMode, setEasyMode] = useState<boolean>(initial.easyMode);

  const foundWordIdsRef = useRef<string[]>(foundWordIds);
  foundWordIdsRef.current = foundWordIds;

  useEffect(() => {
    if (status !== "in_progress") return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    storeProgress(storageKey, { foundWordIds, elapsedSeconds, status, easyMode });
  }, [storageKey, foundWordIds, elapsedSeconds, status, easyMode]);

  const analytics = useGameAnalytics(
    {
      game: "word-search",
      locale,
      isDaily: () => isDailyBoardRound("word-search", puzzle, wordSearchMatchId(puzzle)),
      outcome: roundOutcome(status, foundWordIds.length, puzzle.words.length),
    },
    status === "completed",
    foundWordIds.length > 0,
  );

  const judge = useCallback(
    (start: CellCoord, end: CellCoord) => {
      if (status !== "in_progress" || getLinearPath(start, end).length < 2) return null;
      analytics.start();
      const verdict = judgeSelection(puzzle, foundWordIdsRef.current, start, end, locale);
      if (verdict.kind === "found") {
        const nextFound = [...foundWordIdsRef.current, verdict.wordId];
        foundWordIdsRef.current = nextFound;
        setFoundWordIds(nextFound);
        if (nextFound.length === puzzle.words.length) setStatus("completed");
      }
      return verdict;
    },
    [puzzle, locale, status]
  );

  const selection = useSelection({
    dimensions: puzzle.dimensions,
    grid: puzzle.grid,
    playing: status === "in_progress",
    judge,
  });
  const { anchorCell, currentHoverCell, focusedCell } = selection;

  const activePath = useMemo(
    () => selectionPath(anchorCell, currentHoverCell, focusedCell),
    [anchorCell, currentHoverCell, focusedCell]
  );

  const foundCellsMap = useMemo(() => foundCellColors(puzzle.words, foundWordIds), [puzzle.words, foundWordIds]);

  // Cells of words the player never found, marked after give-up.
  const revealedCells = useMemo(
    () => revealedCellKeys(status, puzzle.words, foundWordIds),
    [status, puzzle.words, foundWordIds]
  );

  const cancelSelection = selection.clear;

  const giveUp = useCallback(() => {
    if (status !== "in_progress") return;
    analytics.start();
    cancelSelection();
    // Revealing the words shows every answer in the list at once.
    setEasyMode(true);
    setStatus("completed");
  }, [cancelSelection, status]);

  return {
    foundWordIds,
    elapsedSeconds,
    status,
    easyMode,
    setEasyMode,
    clueMode: easyMode,
    setClueMode: setEasyMode,
    focusedCell,
    setFocusedCell: selection.setFocusedCell,
    anchorCell,
    activePath,
    foundCellsMap,
    lastCheck: selection.lastCheck,
    handleCellPointerDown: whilePlaying(status, selection.handleCellPointerDown),
    handleCellPointerEnter: whilePlaying(status, selection.handleCellPointerEnter),
    handleCellPointerUp: whilePlaying(status, selection.handleCellPointerUp),
    handleKeyDown: whilePlaying(status, selection.handleKeyDown),
    cancelSelection,
    revealedCells,
    giveUp,
  };
}
