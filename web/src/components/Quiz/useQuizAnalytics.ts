import { useGameAnalytics, type GameOutcome } from "../../lib/game-analytics";
import { isGameMatchRecorded } from "../../lib/player-stats";
import type { Locale } from "../../lib/quiz-types";
import { quizDailyDate } from "./daily-seed";
import type { QuizMatch } from "./useQuizMatch";
import type { QuizSettings } from "./useQuizSettings";
import { isQuizWin } from "./useRecordQuizMatch";

function quizOutcome({ state, session, history, gaveUpRef }: QuizMatch): GameOutcome | null {
  if (state !== "results" || !session) return null;
  if (gaveUpRef.current) return "give_up";
  return isQuizWin(session, history) ? "win" : "loss";
}

/** Game events for the quiz: whether a round is the day's challenge, and how it ended. */
export function useQuizAnalytics(locale: Locale, settings: QuizSettings, match: QuizMatch) {
  const { session } = match;
  return useGameAnalytics(
    {
      game: "quiz",
      locale,
      mode: settings.playMode,
      isDaily: () => {
        const dailyDate = session ? quizDailyDate(session, settings.theme) : undefined;
        return dailyDate !== undefined && !isGameMatchRecorded("quiz", `daily-${dailyDate}`);
      },
      outcome: quizOutcome(match),
    },
    match.state === "results",
    match.restoredVisit,
  );
}
