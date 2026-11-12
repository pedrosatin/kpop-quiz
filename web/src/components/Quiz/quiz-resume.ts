import { CatalogArtifactError, loadQuizCatalog, type QuizCatalog } from "../../data/catalog-loader";
import {
  CatalogSelectionError,
  buildCatalogSession,
  catalogAvailableDecades,
} from "../../data/catalog-session";
import type { QuizQuestion, QuizSession } from "../../lib/quiz-types";
import type { QuizDecadeValue } from "./url-params";
import {
  checkQuizProgressCompatibility,
  clearQuizProgress,
  loadQuizProgressSave,
  type QuizProgressConfigIdentity,
  type QuizProgressLoadResult,
  type QuizProgressSave,
} from "./storage";
import { applyRestoredSave, applyRound, progressConfig, type LoadedRound } from "./quiz-round-state";
import type { QuizLoadContext } from "./types";
import type { QuizMatch } from "./useQuizMatch";

export const isCatalogMissing = (error: unknown): boolean =>
  (error instanceof CatalogSelectionError && error.kind === "missing")
  || (error instanceof CatalogArtifactError && error.kind === "missing");

/**
 * Unavailable storage and a legacy save for another config only set a notice.
 * An invalid payload is deleted and sets the invalid notice. A missing save does nothing.
 */
function noteUnusableSave(
  match: QuizMatch,
  status: Exclude<QuizProgressLoadResult["status"], "ok">,
  config: QuizProgressConfigIdentity,
): void {
  if (status === "unavailable") {
    match.setResumeNotice("storage-unavailable");
  } else if (status === "legacy-elsewhere") {
    match.setResumeNotice("incompatible");
  } else if (status === "invalid") {
    clearQuizProgress(config);
    match.setResumeNotice("invalid");
  }
}

export function tryResumePublished(ctx: QuizLoadContext, round: LoadedRound): void {
  const { locale, settings, match } = ctx;
  const config: QuizProgressConfigIdentity = {
    locale,
    playMode: settings.playMode,
    theme: settings.theme,
    decades: round.decades,
  };
  const loaded = loadQuizProgressSave(config);
  if (loaded.status !== "ok") {
    noteUnusableSave(match, loaded.status, config);
    applyRound(ctx, round);
    return;
  }
  const compat = checkQuizProgressCompatibility(loaded.save, {
    locale,
    playMode: settings.playMode,
    theme: settings.theme,
    decades: round.decades,
    session: round.session,
    sessionSource: round.source,
  });
  if (compat === "ok") {
    match.setResumeNotice(null);
    applyRestoredSave(ctx, loaded.save, round.availableDecades, round.source);
    return;
  }
  // Own-slot drift against the live artifact: drop only this config's slot.
  clearQuizProgress(config);
  match.setResumeNotice(compat === "invalid" ? "invalid" : "incompatible");
  applyRound(ctx, round);
}

/**
 * Accepts a catalog save whose locale, mode, theme and decades match this slot.
 * A mismatch clears the slot and sets the invalid notice. A non-catalog or daily
 * save returns false and stays on disk.
 */
function isResumableCatalogSave(
  { locale, settings, match }: QuizLoadContext,
  save: QuizProgressSave,
  config: QuizProgressConfigIdentity,
): boolean {
  if (save.session_source !== "catalog" || save.theme === "daily") return false;
  // Slot is already keyed by this config; a mismatch here is corrupt identity.
  if (
    save.locale !== locale
    || save.play_mode !== settings.playMode
    || save.theme !== settings.theme
    || save.decades.join(",") !== settings.decadeKey
  ) {
    clearQuizProgress(config);
    match.setResumeNotice("invalid");
    return false;
  }
  return true;
}

/**
 * The session the live catalog builds for the saved question ids, or null when
 * an id is missing from it or the ids do not form a valid round. A catalog
 * round has no published bytes to compare with, so this is the artifact its
 * save is checked against.
 */
async function catalogSessionFor(
  catalog: QuizCatalog,
  save: QuizProgressSave,
  decades: readonly QuizDecadeValue[],
): Promise<QuizSession | null> {
  const byId = new Map(catalog.questions.map((question) => [question.id, question]));
  const questions = save.session.questions.map((question) => byId.get(question.id));
  if (questions.some((question) => question === undefined)) return null;
  try {
    return await buildCatalogSession(catalog, questions as QuizQuestion[], decades);
  } catch (error) {
    if (error instanceof CatalogSelectionError) return null;
    throw error;
  }
}

function adoptCatalogSave(
  ctx: QuizLoadContext,
  save: QuizProgressSave,
  catalog: QuizCatalog,
  session: QuizSession | null,
  config: QuizProgressConfigIdentity,
): boolean {
  const { locale, settings, match } = ctx;
  const compat = session === null ? "incompatible" : checkQuizProgressCompatibility(save, {
    locale,
    playMode: settings.playMode,
    theme: settings.theme,
    decades: settings.decades,
    session,
    sessionSource: "catalog",
    catalogVersion: catalog.catalogVersion,
  });
  if (compat !== "ok") {
    clearQuizProgress(config);
    match.setResumeNotice(compat === "invalid" ? "invalid" : "incompatible");
    return false;
  }
  match.setResumeNotice(null);
  applyRestoredSave(ctx, save, catalogAvailableDecades(catalog), "catalog");
  return true;
}

/** Restores this config's catalog save, if any. True also when a newer load took over. */
export async function tryResumeCatalog(ctx: QuizLoadContext, request: number): Promise<boolean> {
  const { locale, settings, match } = ctx;
  const config = progressConfig(ctx);
  const loaded = loadQuizProgressSave(config);
  if (loaded.status !== "ok") {
    noteUnusableSave(match, loaded.status, config);
    return false;
  }
  const save = loaded.save;
  if (!isResumableCatalogSave(ctx, save, config)) return false;
  try {
    const catalog = await loadQuizCatalog(locale, settings.playMode);
    if (request !== match.loadRequestRef.current) return true;
    const session = await catalogSessionFor(catalog, save, settings.decades);
    if (request !== match.loadRequestRef.current) return true;
    return adoptCatalogSave(ctx, save, catalog, session, config);
  } catch (error) {
    if (request !== match.loadRequestRef.current) return true;
    if (isCatalogMissing(error)) {
      // Catalog gone: this config's save cannot be validated; clear only it.
      clearQuizProgress(config);
      match.setResumeNotice("incompatible");
      return false;
    }
    throw error;
  }
}
