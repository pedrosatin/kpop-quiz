import { CatalogArtifactError, loadQuizCatalog } from "../../data/catalog-loader";
import { buildCatalogSession, CatalogSelectionError } from "../../data/catalog-session";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { loadQuizSessionWithAvailability, QuizArtifactError } from "../../data/session-loader";
import type { Locale, PlayMode, QuizQuestion, QuizSession } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import {
  checkQuizProgressCompatibility,
  listQuizProgressSaves,
  type QuizProgressCompatResult,
  type QuizProgressSave,
} from "./storage";

// Read-only looks at the progress slots of other configs. Nothing here
// deletes, migrates or rewrites a save: each config cleans its own slot when
// the player opens it.

/**
 * The finished daily round of `date` saved in this language that still matches
 * the published session on screen. A save from an earlier board of the same
 * date (another mode or a republished tabuleiro) is ignored so the shared
 * DailyDone card can say the day already counts.
 */
export function findFinishedDailySave(
  locale: Locale,
  date: string,
  playMode: PlayMode,
  published: Pick<QuizSession, "session_id" | "dataset_version">,
): QuizProgressSave | null {
  const finished = listQuizProgressSaves().filter((save) =>
    save.theme === "daily"
    && save.locale === locale
    && save.machine_state === "results"
    && dailySeedDate(save.session) === date
    && save.session_id === published.session_id
    && save.dataset_version === published.dataset_version);
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

/**
 * Whether a save from the other language still matches the live artifact its
 * page would load. The setup offers "Continuar" only when this returns "ok";
 * otherwise it explains that the round can no longer continue.
 */
export async function checkOtherLocaleSaveCompatibility(
  save: QuizProgressSave,
): Promise<QuizProgressCompatResult> {
  try {
    if (save.session_source === "catalog" && save.theme !== "daily") {
      const catalog = await loadQuizCatalog(save.locale, save.play_mode);
      const byId = new Map(catalog.questions.map((question) => [question.id, question]));
      const questions = save.session.questions.map((question) => byId.get(question.id));
      if (questions.some((question) => question === undefined)) return "incompatible";
      const session = await buildCatalogSession(
        catalog,
        questions as QuizQuestion[],
        save.decades,
      );
      return checkQuizProgressCompatibility(save, {
        locale: save.locale,
        playMode: save.play_mode,
        theme: save.theme,
        decades: save.decades,
        session,
        sessionSource: "catalog",
        catalogVersion: catalog.catalogVersion,
      });
    }

    const { session } = await loadQuizSessionWithAvailability(
      save.locale,
      save.play_mode,
      save.theme,
      undefined,
      save.decades,
    );
    return checkQuizProgressCompatibility(save, {
      locale: save.locale,
      playMode: save.play_mode,
      theme: save.theme,
      decades: save.decades,
      session,
      sessionSource: "published",
    });
  } catch (error) {
    if (
      error instanceof QuizArtifactError
      || error instanceof CatalogArtifactError
      || error instanceof CatalogSelectionError
    ) {
      return error.kind === "missing" || error.kind === "unavailable" ? "incompatible" : "invalid";
    }
    throw error;
  }
}
