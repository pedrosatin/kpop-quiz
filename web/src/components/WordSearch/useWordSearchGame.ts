import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { type CellCoord, type GameStatus, WORD_SEARCH_I18N } from "./types";
import {
  getLinearPath,
  formatTime,
  loadStoredProgress,
  type StoredProgress,
} from "./utils";
import { handleWordSearchKeyDown } from "./keyboard";
import type { Locale } from "../../lib/quiz-types";

export function useWordSearchGame(puzzle: WordSearchPuzzle, locale: Locale) {
  const storageKey = `kpop-word-search-${puzzle.puzzle_id}`;
  const t = WORD_SEARCH_I18N[locale];

  const initial = useMemo(() => loadStoredProgress(storageKey), [storageKey]);
  const [foundWordIds, setFoundWordIds] = useState<string[]>(initial.foundWordIds);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(initial.elapsedSeconds);
  const [status, setStatus] = useState<GameStatus>(initial.status);
  const [clueMode, setClueMode] = useState<boolean>(initial.clueMode);

  const [focusedCell, setFocusedCell] = useState<CellCoord>({ row: 0, col: 0 });
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [currentHoverCell, setCurrentHoverCell] = useState<CellCoord | null>(null);
  const [isPointerDown, setIsPointerDown] = useState<boolean>(false);
  const [announcement, setAnnouncement] = useState<string>("");

  const anchorRef = useRef<CellCoord | null>(null);
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
    try {
      const state: StoredProgress = {
        foundWordIds,
        elapsedSeconds,
        status,
        clueMode,
      };
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [storageKey, foundWordIds, elapsedSeconds, status, clueMode]);

  const activePath = useMemo(() => {
    if (!anchorCell) return [];
    const target = currentHoverCell ?? focusedCell;
    return getLinearPath(anchorCell, target);
  }, [anchorCell, currentHoverCell, focusedCell]);

  const foundCellsMap = useMemo(() => {
    const map = new Map<string, number>();
    puzzle.words.forEach((word, wordIndex) => {
      if (foundWordIds.includes(word.id)) {
        const path = getLinearPath(
          { row: word.start_row, col: word.start_col },
          { row: word.end_row, col: word.end_col }
        );
        path.forEach((c) => {
          map.set(`${c.row},${c.col}`, wordIndex % 6);
        });
      }
    });
    return map;
  }, [puzzle.words, foundWordIds]);

  const checkSelection = useCallback(
    (start: CellCoord, end: CellCoord) => {
      const path = getLinearPath(start, end);
      if (path.length < 3) return false;

      const letters = path.map((c) => puzzle.grid[c.row]?.[c.col] ?? "").join("");
      const revLetters = letters.split("").reverse().join("");

      const currentFound = foundWordIdsRef.current;
      const match = puzzle.words.find((w) => {
        if (currentFound.includes(w.id)) return false;
        const forward =
          w.start_row === start.row &&
          w.start_col === start.col &&
          w.end_row === end.row &&
          w.end_col === end.col &&
          w.word === letters;
        const reverse =
          w.start_row === end.row &&
          w.start_col === end.col &&
          w.end_row === start.row &&
          w.end_col === start.col &&
          w.word === revLetters;
        return forward || reverse;
      });

      if (match) {
        setFoundWordIds((prev) => {
          if (prev.includes(match.id)) return prev;
          const nextFound = [...prev, match.id];
          foundWordIdsRef.current = nextFound;
          const name = match.labels[locale] || match.canonical_name;
          if (nextFound.length === puzzle.words.length) {
            setStatus("completed");
            setAnnouncement(t.gameCompleteAnnouncement(puzzle.words.length, formatTime(elapsedSeconds)));
          } else {
            setAnnouncement(t.wordFoundAnnouncement(name, nextFound.length, puzzle.words.length));
          }
          return nextFound;
        });
        return true;
      }
      return false;
    },
    [puzzle, locale, t, elapsedSeconds]
  );

  const handleCellPointerDown = useCallback((row: number, col: number) => {
    setIsPointerDown(true);
    setFocusedCell({ row, col });
    anchorRef.current = { row, col };
    setAnchorCell({ row, col });
    setCurrentHoverCell({ row, col });
  }, []);

  const handleCellPointerEnter = useCallback((row: number, col: number) => {
    if (isPointerDown && anchorRef.current) {
      setCurrentHoverCell({ row, col });
    }
  }, [isPointerDown]);

  const handleCellPointerUp = useCallback((row: number, col: number) => {
    const start = anchorRef.current;
    if (start) {
      checkSelection(start, { row, col });
      anchorRef.current = null;
      setAnchorCell(null);
      setCurrentHoverCell(null);
    }
    setIsPointerDown(false);
  }, [checkSelection]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      handleWordSearchKeyDown(e, {
        focusedCell,
        anchorCell,
        dimensions: puzzle.dimensions,
        setFocusedCell,
        setAnchorCell,
        setCurrentHoverCell,
        checkSelection,
      });
    },
    [focusedCell, anchorCell, puzzle.dimensions, checkSelection]
  );

  return {
    foundWordIds,
    elapsedSeconds,
    status,
    clueMode,
    setClueMode,
    focusedCell,
    setFocusedCell,
    anchorCell,
    activePath,
    foundCellsMap,
    announcement,
    handleCellPointerDown,
    handleCellPointerEnter,
    handleCellPointerUp,
    handleKeyDown,
    cancelSelection: () => {
      setAnchorCell(null);
      setCurrentHoverCell(null);
      setIsPointerDown(false);
    },
  };
}
