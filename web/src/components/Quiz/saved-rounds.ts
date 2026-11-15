import { dailyReferenceDate } from "../../data/daily-artifact";
import type { Locale, PlayMode } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import { listQuizProgressSaves, type QuizProgressSave } from "./storage";

// Read-only looks at the progress slots of other configs. Nothing here
// deletes, migrates or rewrites a save: each config cleans its own slot when
// the player opens it.

/**
 * The finished daily round of `date` saved in this language, preferring the
 * given mode. The daily slot is one per language and mode, so a player who
 * finished the day in Standard and opens it in Assisted finds the round here.
 */
export function findFinishedDailySave(locale: Locale, date: string, playMode: PlayMode): QuizProgressSave | null {
  const finished = listQuizProgressSaves().filter((save) =>
    save.theme === "daily"
    && save.locale === locale
    && save.machine_state === "results"
    && dailySeedDate(save.session) === date);
  return finished.find((save) => save.play_mode === playMode)
    ?? finished.sort((a, b) => b.started_at_ms - a.started_at_ms)[0]
    ?? null;
}

/**
 * The most recently started round in progress in another language. A daily
 * round counts only on its own date: one from an earlier day is no longer
 * today's challenge, and its slot is dropped when that language opens it.
 */
export function findOtherLocaleRound(locale: Locale, today: string = dailyReferenceDate()): QuizProgressSave | null {
  return listQuizProgressSaves()
    .filter((save) =>
      save.locale !== locale
      && save.machine_state !== "results"
      && (save.theme !== "daily" || dailySeedDate(save.session) === today))
    .sort((a, b) => b.started_at_ms - a.started_at_ms)[0] ?? null;
}
