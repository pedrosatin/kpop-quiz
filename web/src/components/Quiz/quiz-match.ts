import { staleDailyDate } from "../../data/daily-artifact";
import { dailyMatchId } from "../../lib/player-stats";
import type { QuizSession } from "../../lib/quiz-types";
import type { DailyRound } from "../../lib/use-record-daily-match";
import { quizDailyDate } from "./daily-seed";
import type { QuestionResult } from "./types";
import type { QuizTheme } from "./url-params";

export function isQuizWin(session: QuizSession, history: QuestionResult[]): boolean {
  const total = session.questions.length || 10;
  return history.filter((h) => h.isCorrect).length >= Math.ceil(total / 2);
}

/**
 * Round the Quiz reports to `useRecordDailyMatch`. Stale daily sessions count
 * nothing. A daily theme uses `daily-<date>` with the board's day; other
 * themes use `session-<id>` with no date (free play).
 */
export function quizDailyRound(session: QuizSession | null, theme: QuizTheme): DailyRound | null {
  if (!session || staleDailyDate(session)) return null;
  const dailyDate = quizDailyDate(session, theme);
  if (dailyDate) return { matchId: dailyMatchId(dailyDate), date: dailyDate };
  return { matchId: `session-${session.session_id || "default"}` };
}
