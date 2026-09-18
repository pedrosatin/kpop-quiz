import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { type CellCoord, type GameStatus, WORD_SEARCH_I18N } from "./types";
import {
  getLinearPath,
  formatTime,
  isWordMatch,
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
  const [easyMode, setEasyMode] = useState<boolean>(initial.easyMode);

  const [focusedCell, setFocusedCell] = useState<CellCoord>({ row: 0, col: 0 });
  const [anchorCell, setAnchorCell] = useState<CellCoord | null>(null);
  const [currentHoverCell, setCurrentHoverCell] = useState<CellCoord | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");

  const anchorRef = useRef<CellCoord | null>(null);
  anchorRef.current = anchorCell;

  const currentHoverRef = useRef<CellCoord | null>(null);
  currentHoverRef.current = currentHoverCell;

  const isPointerDownRef = useRef<boolean>(false);
  const pointerDownCellRef = useRef<CellCoord | null>(null);
  const anchorAtPointerDownRef = useRef<CellCoord | null>(null);
  const didDragRef = useRef<boolean>(false);

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
        easyMode,
      };
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [storageKey, foundWordIds, elapsedSeconds, status, easyMode]);

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
        return isWordMatch(w, start, end, letters, revLetters, locale);
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
    isPointerDownRef.current = true;
    pointerDownCellRef.current = { row, col };
    anchorAtPointerDownRef.current = anchorRef.current;
    didDragRef.current = false;
    setFocusedCell({ row, col });

    if (!anchorRef.current) {
      anchorRef.current = { row, col };
      setAnchorCell({ row, col });
      setCurrentHoverCell({ row, col });
    } else {
      setCurrentHoverCell({ row, col });
    }
  }, []);

  const handleCellPointerEnter = useCallback((row: number, col: number) => {
    const target = { row, col };
    setFocusedCell(target);

    if (isPointerDownRef.current) {
      const downCell = pointerDownCellRef.current;
      if (downCell && (downCell.row !== row || downCell.col !== col)) {
        didDragRef.current = true;
      }
      setCurrentHoverCell(target);
    } else if (anchorRef.current) {
      setCurrentHoverCell(target);
    }
  }, []);

  const handleCellPointerUp = useCallback(
    (row: number, col: number) => {
      const downCell = pointerDownCellRef.current;
      const isDrag =
        didDragRef.current ||
        (downCell !== null && (downCell.row !== row || downCell.col !== col));
      const target = { row, col };

      if (isDrag) {
        const start = anchorAtPointerDownRef.current ?? downCell ?? anchorRef.current;
        if (start) {
          checkSelection(start, target);
        }
        anchorRef.current = null;
        setAnchorCell(null);
        setCurrentHoverCell(null);
      } else {
        const priorAnchor = anchorAtPointerDownRef.current;

        if (!priorAnchor) {
          anchorRef.current = target;
          setAnchorCell(target);
          setCurrentHoverCell(target);
        } else if (priorAnchor.row === target.row && priorAnchor.col === target.col) {
          anchorRef.current = null;
          setAnchorCell(null);
          setCurrentHoverCell(null);
        } else {
          const path = getLinearPath(priorAnchor, target);
          if (path.length > 0) {
            checkSelection(priorAnchor, target);
            anchorRef.current = null;
            setAnchorCell(null);
            setCurrentHoverCell(null);
          } else {
            anchorRef.current = target;
            setAnchorCell(target);
            setCurrentHoverCell(target);
          }
        }
      }

      isPointerDownRef.current = false;
      pointerDownCellRef.current = null;
      anchorAtPointerDownRef.current = null;
      didDragRef.current = false;
    },
    [checkSelection]
  );

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (!isPointerDownRef.current) return;

      if (didDragRef.current) {
        const start = anchorAtPointerDownRef.current ?? pointerDownCellRef.current;
        const end = currentHoverRef.current;
        if (start && end && (start.row !== end.row || start.col !== end.col)) {
          checkSelection(start, end);
        }
        anchorRef.current = null;
        setAnchorCell(null);
        setCurrentHoverCell(null);
      }

      isPointerDownRef.current = false;
      pointerDownCellRef.current = null;
      anchorAtPointerDownRef.current = null;
      didDragRef.current = false;
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
    };
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

  const cancelSelection = useCallback(() => {
    anchorRef.current = null;
    setAnchorCell(null);
    setCurrentHoverCell(null);
    isPointerDownRef.current = false;
    pointerDownCellRef.current = null;
    didDragRef.current = false;
  }, []);

  return {
    foundWordIds,
    elapsedSeconds,
    status,
    easyMode,
    setEasyMode,
    clueMode: easyMode,
    setClueMode: setEasyMode,
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
    cancelSelection,
  };
}
