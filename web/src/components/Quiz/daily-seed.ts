import { dailyReferenceDate } from "../../data/daily-artifact";
import type { QuizSession } from "../../lib/quiz-types";
import type { QuizTheme } from "./url-params";

/** Date a daily session was published for, read from its seed; undefined for other seeds. */
export function dailySeedDate(session: QuizSession): string | undefined {
  return session.config.seed?.startsWith("kpop-daily-")
    ? session.config.seed.replace("kpop-daily-", "")
    : undefined;
}

/** Day a daily-theme round counts for: its seed's date, else today in Sao Paulo. Undefined for other themes. */
export function quizDailyDate(session: QuizSession, theme: QuizTheme): string | undefined {
  if (theme !== "daily") return undefined;
  return dailySeedDate(session) ?? dailyReferenceDate();
}
