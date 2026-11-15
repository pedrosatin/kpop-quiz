import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import { scoreGuess } from "../../data/code-groups";
import { useGameAnalytics } from "../../lib/game-analytics";
import { clearCodeGroupsSave, loadCodeGroupsSave, storeCodeGroupsSave } from "./code-groups-save";
import { isDailyBoardRound } from "../../lib/player-stats";
import { codeGroupsMatchId } from "./useRecordCodeGroupsMatch";
import type { Locale } from "../../lib/quiz-types";
import {
  EMPTY_SELECTION,
  guessEndsRound,
  guessRejection,
  hasRoundProgress,
  isRoundFinished,
  isRoundWon,
  isSelectionComplete,
  roundOutcome,
  startingHistory,
  startingSelection,
  withSlot,
  type CodeGroupsFeedback,
} from "./code-groups-state";

export {
  clearCodeGroupsSave,
  codeGroupsStorageKey,
  loadCodeGroupsSave,
  storeCodeGroupsSave,
  type CodeGroupsSave,
} from "./code-groups-save";

export interface UseCodeGroupsGame {
  selection: string[];
  history: CodeGroupsGuess[];
  /** Whether every slot holds a distinct symbol. */
  selectionComplete: boolean;
  won: boolean;
  finished: boolean;
  selectValue: (index: number, qid: string) => void;
  submit: () => void;
  restart: () => void;
  /** String keys or composed messages for the live region; set on rejections and guesses. */
  feedback: CodeGroupsFeedback;
}

export function useCodeGroupsGame(puzzle: CodeGroupsPuzzle, locale: Locale): UseCodeGroupsGame {
  const initialSave = useRef(loadCodeGroupsSave(puzzle));

  const [selection, setSelection] = useState<string[]>(() => startingSelection(initialSave.current?.selection));
  const [history, setHistory] = useState<CodeGroupsGuess[]>(
    () => startingHistory(puzzle, initialSave.current?.history),
  );
  const [feedback, setFeedback] = useState<CodeGroupsFeedback>(null);

  const submitLocked = useRef(false);
  useEffect(() => { submitLocked.current = false; }, [history, selection]);

  const won = isRoundWon(history);
  const finished = isRoundFinished(puzzle, history);
  const analytics = useGameAnalytics(
    {
      game: "code",
      locale,
      isDaily: () => isDailyBoardRound("code", puzzle, codeGroupsMatchId(puzzle)),
      outcome: roundOutcome(won, finished),
    },
    finished,
    history.length > 0,
  );

  useEffect(() => {
    if (!hasRoundProgress(history, selection)) return;
    storeCodeGroupsSave(puzzle, { history: history.map((guess) => guess.ids), selection });
  }, [puzzle, history, selection]);

  const selectValue = useCallback(
    (index: number, qid: string) => {
      if (finished) return;
      analytics.start();
      setFeedback(null);
      setSelection((prev) => withSlot(prev, index, qid));
    },
    [finished],
  );

  const submit = useCallback(() => {
    if (finished || submitLocked.current) return;
    const rejection = guessRejection(history, selection);
    if (rejection) {
      setFeedback({ kind: rejection });
      return;
    }
    analytics.start();
    submitLocked.current = true;
    const guess = scoreGuess(puzzle, selection);
    setFeedback({ kind: "attempt", attempt: guess });
    setHistory((prev) => [...prev, guess]);
    // Keep the last pick between attempts so one slot can change at a time.
    // Clear only when the round ends, so a finished save stays loadable
    // (history at the limit with empty slots).
    if (guessEndsRound(puzzle, guess, history.length)) setSelection([...EMPTY_SELECTION]);
  }, [finished, history, puzzle, selection]);

  const restart = useCallback(() => {
    submitLocked.current = false;
    analytics.reset();
    clearCodeGroupsSave(puzzle);
    setHistory([]);
    setSelection([...EMPTY_SELECTION]);
    setFeedback(null);
  }, [puzzle]);

  return {
    selection,
    history,
    selectionComplete: isSelectionComplete(selection),
    won,
    finished,
    selectValue,
    submit,
    restart,
    feedback,
  };
}
