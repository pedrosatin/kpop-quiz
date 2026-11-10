import { QuizArtifactError, loadQuizSessionWithAvailability } from "../../data/session-loader";
import { CatalogArtifactError } from "../../data/catalog-loader";
import { CatalogSelectionError, selectCatalogRound, type CatalogRound } from "../../data/catalog-session";
import { loadQuizProgressSave } from "./storage";
import { isCatalogMissing, tryResumeCatalog, tryResumePublished } from "./quiz-resume";
import { applyRound, progressConfig, type LoadedRound } from "./quiz-round-state";
import type { QuizLoadContext, QuizMachineState, ReplayNotice } from "./types";
import type { QuizMatch } from "./useQuizMatch";

export function catalogLoadedRound(ctx: QuizLoadContext, round: CatalogRound): LoadedRound {
  return {
    session: round.session,
    availableDecades: round.availableDecades,
    decades: ctx.settings.decades,
    source: "catalog",
    replayStatus: round.status === "repeats" ? "repeats" : "ok",
  };
}

export function loadPublished(
  ctx: QuizLoadContext,
  request: number,
  status: ReplayNotice = null,
  nextState: QuizMachineState = "setup",
  skipResume = false,
): Promise<void> {
  const { locale, settings, match } = ctx;
  return loadQuizSessionWithAvailability(locale, settings.playMode, settings.theme, undefined, settings.decades)
    .then(({ session, availableDecades, decades }) => {
      if (request !== match.loadRequestRef.current) return;
      const round: LoadedRound = { session, availableDecades, decades, source: "published", replayStatus: status };
      if (skipResume || nextState !== "setup") {
        applyRound(ctx, round, nextState);
        return;
      }
      tryResumePublished(ctx, round);
    });
}

/** Fresh catalog draw for setup only: this config's slot stays until the player starts. */
function drawCatalogForSetup(ctx: QuizLoadContext, request: number): Promise<void> {
  const { locale, settings: { playMode, decades }, match } = ctx;
  return selectCatalogRound({ locale, playMode, decades, avoidPrevious: false })
    .then((round) => {
      if (request !== match.loadRequestRef.current) return;
      const existing = loadQuizProgressSave(progressConfig(ctx));
      if (existing.status === "ok" || existing.status === "legacy-elsewhere") {
        match.setResumeNotice("incompatible");
      }
      applyRound(ctx, catalogLoadedRound(ctx, round));
    })
    .catch((error): Promise<void> | void => {
      if (request !== match.loadRequestRef.current) return Promise.resolve();
      if (error instanceof CatalogSelectionError && error.kind === "unavailable") {
        match.setSession(null);
        match.setSessionSource("catalog");
        match.setReplayStatus(null);
        match.setState("unavailable");
        return;
      }
      if (isCatalogMissing(error)) return loadPublished(ctx, request, "legacy-repeats");
      throw error;
    });
}

function loadCatalogRound(ctx: QuizLoadContext, request: number): Promise<void> {
  const { match } = ctx;
  // Resume runs before drawing a new catalog set so the same selection returns.
  return tryResumeCatalog(ctx, request).then((resumed) => {
    if (request !== match.loadRequestRef.current || resumed) return;
    return drawCatalogForSetup(ctx, request);
  });
}

function showLoadFailure(match: QuizMatch, request: number, error: unknown): void {
  if (request !== match.loadRequestRef.current) return;
  if (error instanceof CatalogSelectionError) {
    // Missing already fell back above; treat a stray missing as invalid path noise.
    match.setState(error.kind === "unavailable" ? "unavailable" : "invalid");
    return;
  }
  if (error instanceof QuizArtifactError || error instanceof CatalogArtifactError) {
    match.setState(error.kind === "missing" ? "missing" : "invalid");
    return;
  }
  match.setState("invalid");
}

/**
 * Daily stays on the published session of the day. General quiz prefers the
 * validated catalog when published. Missing catalog → legacy published
 * sessions with an explicit repeat notice (operator decision 28/10/2026).
 * Corrupted catalog is a closed error with no unvalidated fallback.
 */
export function loadRound(ctx: QuizLoadContext): void {
  const { settings, match } = ctx;
  const request = ++match.loadRequestRef.current;
  if (match.state !== "setup") match.setState("loading");
  const pending = settings.theme === "daily" ? loadPublished(ctx, request) : loadCatalogRound(ctx, request);
  Promise.resolve(pending).catch((error) => showLoadFailure(match, request, error));
}
