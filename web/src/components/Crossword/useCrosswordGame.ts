import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CrosswordPuzzle } from "../../data/crossword";
import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyMatchRecorded, recordMatchOnce } from "../../lib/player-stats";
import type { Locale } from "../../lib/quiz-types";
import {
  clearCrosswordSave,
  isEntrySolved,
  loadCrosswordSave,
  storeCrosswordSave,
  wrongSquares,
  type CrosswordStatus,
} from "./crossword-save";

export interface UseCrosswordGame {
  values: Record<string, string>;
  status: CrosswordStatus;
  finished: boolean;
  checks: number;
  /** Words whose letters were all right when the round ended (or now). */
  correctWords: number;
  /** Bumps on every check that is not a win, so the verdict is announced again. */
  wrongCheck: number;
  /**
   * Squares ("row:col") that were wrong or empty at the last check. A square
   * leaves the set when the player edits it; the next check rebuilds it.
   */
  wrongCells: ReadonlySet<string>;
  setLetters: (updates: Record<string, string>) => void;
  /** Checks the board and returns true when it is solved. */
  check: () => boolean;
  reveal: () => void;
  restart: () => void;
}

/**
 * The board's id under the earlier per-board stats key, the envelope checksum.
 * The daily match itself counts once per `reference_date` (ADR 030), so a board
 * swapped for the same date does not count again.
 */
export function crosswordMatchId(puzzle: CrosswordPuzzle): string {
  return `crossword-${puzzle.dataset_version}`;
}

const NO_SQUARES: ReadonlySet<string> = new Set();

/** The marked squares minus the ones just edited; the same set when none was marked. */
export function withoutSquares(marked: ReadonlySet<string>, edited: readonly string[]): ReadonlySet<string> {
  if (!edited.some((key) => marked.has(key))) return marked;
  const rest = new Set(marked);
  for (const key of edited) rest.delete(key);
  return rest;
}

export function useCrosswordGame(puzzle: CrosswordPuzzle, locale: Locale): UseCrosswordGame {
  const [initialSave] = useState(() => loadCrosswordSave(puzzle));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(initialSave?.values ?? {}) }));
  const [status, setStatus] = useState<CrosswordStatus>(initialSave?.status ?? "playing");
  const [checks, setChecks] = useState(initialSave?.checks ?? 0);
  const [wrongCheck, setWrongCheck] = useState(0);
  const [wrongCells, setWrongCells] = useState<ReadonlySet<string>>(NO_SQUARES);

  const finished = status !== "playing";
  const resumed = initialSave !== null;
  const analytics = useGameAnalytics(
    {
      game: "crossword",
      locale,
      isDaily: () => !isDailyMatchRecorded("crossword", puzzle.reference_date, crosswordMatchId(puzzle)),
      // Revealing the board is how the player gives up; the round has no loss.
      outcome: status === "won" ? "win" : status === "revealed" ? "give_up" : null,
    },
    finished,
    resumed,
  );

  useEffect(() => {
    const touched = checks > 0 || finished || Object.values(values).some(Boolean);
    if (!touched) return;
    storeCrosswordSave(puzzle, { values, status, checks });
  }, [puzzle, values, status, checks, finished]);

  // A restored finished round is counted once, on the first load that finds it uncounted.
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!finished) {
      recorded.current = null;
      return;
    }
    const matchId = crosswordMatchId(puzzle);
    if (recorded.current === matchId) return;
    recordMatchOnce("crossword", matchId, status === "won", puzzle.reference_date);
    recorded.current = matchId;
  }, [finished, status, puzzle]);

  const setLetters = useCallback(
    (updates: Record<string, string>) => {
      if (finished) return;
      analytics.start();
      setWrongCheck(0);
      setWrongCells((marked) => withoutSquares(marked, Object.keys(updates)));
      setValues((prev) => ({ ...prev, ...updates }));
    },
    [finished],
  );

  const check = useCallback(() => {
    if (finished) return false;
    analytics.start();
    setChecks((n) => n + 1);
    const wrong = wrongSquares(puzzle, values);
    setWrongCells(wrong.size ? wrong : NO_SQUARES);
    if (!wrong.size) setStatus("won");
    else setWrongCheck((n) => n + 1);
    return !wrong.size;
  }, [finished, puzzle, values]);

  const reveal = useCallback(() => {
    if (finished) return;
    analytics.start();
    setWrongCheck(0);
    setWrongCells(NO_SQUARES);
    setStatus("revealed");
  }, [finished]);

  const restart = useCallback(() => {
    analytics.reset();
    clearCrosswordSave(puzzle);
    setValues({});
    setStatus("playing");
    setChecks(0);
    setWrongCheck(0);
    setWrongCells(NO_SQUARES);
  }, [puzzle]);

  const correctWords = status === "won"
    ? puzzle.entries.length
    : puzzle.entries.filter((entry) => isEntrySolved(entry, values)).length;

  return { values, status, finished, checks, correctWords, wrongCheck, wrongCells, setLetters, check, reveal, restart };
}
