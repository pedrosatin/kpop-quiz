import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useGameAnalytics, type GameOutcome } from "../../lib/game-analytics";
import { isDailyBoardRound } from "../../lib/player-stats";
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

function roundOutcome(
  status: GameStatus,
  foundCount: number,
  totalWords: number,
): GameOutcome | null {
  if (status !== "completed") return null;
  return foundCount >= totalWords ? "win" : "give_up";
}

export function useStrandsGame(
  puzzle: StrandsPuzzle,
  locale: Locale,
  options: { daily?: boolean } = {},
) {
  const daily = options.daily !== false;
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

  const analytics = useGameAnalytics(
    {
      game: "strands",
      locale,
      isDaily: () => daily && isDailyBoardRound("strands", puzzle, strandsMatchId(puzzle)),
      outcome: roundOutcome(status, foundKeys.length, puzzle.words.length),
    },
    status === "completed",
    foundKeys.length > 0,
  );

  const judge = useCallback(
    (path: CellCoord[]) => {
      if (status !== "in_progress") return null;
      analytics.start();
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
    if (status !== "in_progress") return;
    analytics.start();
    trail.clear();
    setStatus("completed");
  }, [trail, status, analytics]);

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
    confirmTrail: whilePlaying(status, trail.confirm),
    cancelTrail: whilePlaying(status, trail.cancel),
    giveUp,
  };
}
