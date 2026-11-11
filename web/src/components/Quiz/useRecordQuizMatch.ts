import { useEffect, type MutableRef } from "preact/hooks";
import {
  isGameMatchRecorded,
  recordMatchOnce,
} from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import { quizDailyDate } from "./daily-seed";
import type { QuestionResult, QuizMachineState } from "./types";
import type { QuizTheme } from "./url-params";

export function isQuizWin(session: QuizSession, history: QuestionResult[]): boolean {
  const total = session.questions.length || 10;
  return history.filter((h) => h.isCorrect).length >= Math.ceil(total / 2);
}

/** Records one finished match in player stats; a restored or replayed result stays deduplicated. */
export function useRecordQuizMatch(
  state: QuizMachineState,
  session: QuizSession | null,
  history: QuestionResult[],
  theme: QuizTheme,
  recordedMatchRef: MutableRef<string | null>,
): void {
  useEffect(() => {
    if (state !== "results" || !session) return;
    const dailyDate = quizDailyDate(session, theme);
    const matchId = dailyDate ? `daily-${dailyDate}` : `session-${session.session_id || "default"}`;

    if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("quiz", matchId)) {
      recordMatchOnce("quiz", matchId, isQuizWin(session, history), dailyDate);
      recordedMatchRef.current = matchId;
    }
  }, [state, session, history, theme]);
}
