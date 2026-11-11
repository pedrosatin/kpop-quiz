import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CrosswordPuzzle } from "../../data/crossword";
import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyMatchRecorded, recordMatchOnce } from "../../lib/player-stats";
import type { Locale } from "../../lib/quiz-types";
import {
  clearCrosswordSave,
  isBoardSolved,
  isEntrySolved,
  loadCrosswordSave,
  storeCrosswordSave,
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
  setLetters: (updates: Record<string, string>) => void;
  check: () => void;
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

export function useCrosswordGame(puzzle: CrosswordPuzzle, locale: Locale): UseCrosswordGame {
  const [initialSave] = useState(() => loadCrosswordSave(puzzle));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(initialSave?.values ?? {}) }));
  const [status, setStatus] = useState<CrosswordStatus>(initialSave?.status ?? "playing");
  const [checks, setChecks] = useState(initialSave?.checks ?? 0);
  const [wrongCheck, setWrongCheck] = useState(0);

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
      setValues((prev) => ({ ...prev, ...updates }));
    },
    [finished],
  );

  const check = useCallback(() => {
    if (finished) return;
    analytics.start();
    setChecks((n) => n + 1);
    if (isBoardSolved(puzzle, values)) setStatus("won");
    else setWrongCheck((n) => n + 1);
  }, [finished, puzzle, values]);

  const reveal = useCallback(() => {
    if (finished) return;
    analytics.start();
    setWrongCheck(0);
    setStatus("revealed");
  }, [finished]);

  const restart = useCallback(() => {
    analytics.reset();
    clearCrosswordSave(puzzle);
    setValues({});
    setStatus("playing");
    setChecks(0);
    setWrongCheck(0);
  }, [puzzle]);

  const correctWords = status === "won"
    ? puzzle.entries.length
    : puzzle.entries.filter((entry) => isEntrySolved(entry, values)).length;

  return { values, status, finished, checks, correctWords, wrongCheck, setLetters, check, reveal, restart };
}
