import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import type { StrandsPuzzle } from "../../lib/strands-types";
import { strandsWordKey } from "../../lib/strands-types";
import {
  foundCellColors,
  isSpangramFound,
  judgeTrail,
  spangramCellKeys,
} from "./trail";
import type { CellCoord, GameStatus } from "./types";
import { useStrandsTrail } from "./useStrandsTrail";

export function strandsMatchId(puzzle: StrandsPuzzle): string {
  return `strands-${puzzle.puzzle_id}`;
}

function ignoreInput(): void {}

function whilePlaying<A extends unknown[]>(
  status: GameStatus,
  handler: (...args: A) => void,
): (...args: A) => void {
  return status === "in_progress" ? handler : ignoreInput;
}

export function useStrandsGame(puzzle: StrandsPuzzle, locale: Locale) {
  const [foundKeys, setFoundKeys] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState<GameStatus>("in_progress");

  const foundRef = useRef(foundKeys);
  foundRef.current = foundKeys;

  useEffect(() => {
    if (status !== "in_progress") return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const judge = useCallback(
    (path: CellCoord[]) => {
      if (status !== "in_progress") return null;
      const verdict = judgeTrail(puzzle, foundRef.current, path);
      if (verdict.kind === "found") {
        const next = [...foundRef.current, verdict.wordKey];
        foundRef.current = next;
        setFoundKeys(next);
        if (next.length === puzzle.words.length) setStatus("completed");
      }
      return verdict;
    },
    [puzzle, status],
  );

  const trail = useStrandsTrail({
    dimensions: puzzle.dimensions,
    grid: puzzle.grid,
    playing: status === "in_progress",
    judge,
  });

  const foundCellsMap = useMemo(
    () => foundCellColors(puzzle, foundKeys),
    [puzzle, foundKeys],
  );
  const spangramKeys = useMemo(() => spangramCellKeys(puzzle), [puzzle]);
  const spangramFound = isSpangramFound(puzzle, foundKeys);

  const wordName = useCallback(
    (key: string) => {
      const word = puzzle.words.find((entry) => strandsWordKey(entry) === key);
      if (!word) return key;
      return word.labels[locale] || word.labels.en;
    },
    [puzzle, locale],
  );

  const giveUp = useCallback(() => {
    trail.clear();
    setStatus("completed");
  }, [trail]);

  return {
    foundKeys,
    elapsedSeconds,
    status,
    foundCellsMap,
    spangramKeys,
    spangramFound,
    wordName,
    focusedCell: trail.focusedCell,
    path: trail.path,
    activeLetters: trail.activeLetters,
    lastCheck: trail.lastCheck,
    handleCellPointerDown: whilePlaying(status, trail.handleCellPointerDown),
    handleCellPointerEnter: whilePlaying(status, trail.handleCellPointerEnter),
    handleCellPointerUp: whilePlaying(status, trail.handleCellPointerUp),
    handleKeyDown: whilePlaying(status, trail.handleKeyDown),
    giveUp,
  };
}
