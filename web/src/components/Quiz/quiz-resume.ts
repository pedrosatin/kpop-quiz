import { CatalogArtifactError, loadQuizCatalog, type QuizCatalog } from "../../data/catalog-loader";
import {
  CatalogSelectionError,
  buildCatalogSession,
  catalogAvailableDecades,
} from "../../data/catalog-session";
import type { QuizQuestion, QuizSession } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import type { QuizDecadeValue, QuizTheme } from "./url-params";
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

function isOtherDaySave(theme: QuizTheme, save: QuizProgressSave, session: QuizSession): boolean {
  if (theme !== "daily") return false;
  const savedDate = dailySeedDate(save.session);
  const liveDate = dailySeedDate(session);
  return savedDate !== undefined && liveDate !== undefined && savedDate !== liveDate;
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
  if (isOtherDaySave(settings.theme, loaded.save, round.session)) {
    clearQuizProgress(config);
    match.setResumeNotice(null);
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
  clearQuizProgress(config);
  match.setResumeNotice(compat === "invalid" ? "invalid" : "incompatible");
  applyRound(ctx, round);
}

function isResumableCatalogSave(
  { locale, settings, match }: QuizLoadContext,
  save: QuizProgressSave,
  config: QuizProgressConfigIdentity,
): boolean {
  if (save.session_source !== "catalog" || save.theme === "daily") return false;
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
      clearQuizProgress(config);
      match.setResumeNotice("incompatible");
      return false;
    }
    throw error;
  }
}
