import { QuizArtifactError } from "../../data/session-loader";
import { CatalogSelectionError, selectCatalogRound, type CatalogRound } from "../../data/catalog-session";
import { clearQuizProgress } from "./storage";
import { catalogLoadedRound, loadPublished } from "./quiz-load";
import { isCatalogMissing } from "./quiz-resume";
import { applyRound, computeDeadline, progressConfig, resetRound } from "./quiz-round-state";
import type { QuizLoadContext } from "./types";
import { freshRoundProgress, type QuizProgressOverrides } from "./useQuizProgress";

/** Starts the published round again with the same ten questions. */
function replayPublishedRound(ctx: QuizLoadContext, extra: QuizProgressOverrides = {}): void {
  const { match, analytics, timerSeconds, persistProgress } = ctx;
  const startedAt = Date.now();
  match.startTimeRef.current = startedAt;
  match.recordedMatchRef.current = null;
  const nextDeadline = computeDeadline(timerSeconds);
  resetRound(ctx, match.session?.questions.length ?? 0, "question.ready", nextDeadline);
  match.persistReadyRef.current = true;
  analytics.start();
  match.focusQuestionRef.current = true;
  persistProgress("question.ready", { ...freshRoundProgress(nextDeadline, startedAt), ...extra });
}

function beginReplayedRound({ match, analytics }: QuizLoadContext): number {
  const startedAt = Date.now();
  match.startTimeRef.current = startedAt;
  match.recordedMatchRef.current = null;
  analytics.start();
  match.focusQuestionRef.current = true;
  match.persistReadyRef.current = true;
  return startedAt;
}

function applyCatalogReplay(ctx: QuizLoadContext, round: CatalogRound): void {
  const loaded = catalogLoadedRound(ctx, round);
  applyRound(ctx, loaded, "question.ready");
  const startedAt = beginReplayedRound(ctx);
  ctx.persistProgress("question.ready", {
    ...freshRoundProgress(computeDeadline(ctx.timerSeconds), startedAt),
    session: round.session,
    sessionSource: "catalog",
    replayNotice: loaded.replayStatus,
  });
}

function replayFromPublished(ctx: QuizLoadContext, request: number): void {
  const { match } = ctx;
  loadPublished(ctx, request, "legacy-repeats", "question.ready", true)
    .then(() => {
      if (request !== match.loadRequestRef.current) return;
      beginReplayedRound(ctx);
    })
    .catch((error) => {
      if (request !== match.loadRequestRef.current) return;
      match.setState(error instanceof QuizArtifactError ? error.kind : "invalid");
    });
}

function handleReplayFailure(ctx: QuizLoadContext, request: number, error: unknown): void {
  const { match } = ctx;
  if (request !== match.loadRequestRef.current) return;
  if (error instanceof CatalogSelectionError && error.kind === "unavailable") {
    match.setState("unavailable");
    return;
  }
  if (isCatalogMissing(error)) {
    replayFromPublished(ctx, request);
    return;
  }
  match.setState("invalid");
}

/** Draws a new catalog set when another combination exists. */
function replayCatalogRound(ctx: QuizLoadContext): void {
  const { locale, settings: { playMode, decades }, match } = ctx;
  const request = ++match.loadRequestRef.current;
  match.setState("loading");
  selectCatalogRound({ locale, playMode, decades, avoidPrevious: true })
    .then((round) => {
      if (request !== match.loadRequestRef.current) return;
      applyCatalogReplay(ctx, round);
    })
    .catch((error) => handleReplayFailure(ctx, request, error));
}

/**
 * Daily keeps the published day session. Legacy published rounds (catalog
 * absent) reset the same ten with the legacy repeat notice. Catalog-backed
 * general quiz draws a new set; a missing catalog on restart falls back to
 * legacy with the same notice as load.
 */
export function restartRound(ctx: QuizLoadContext): void {
  const { settings, match } = ctx;
  clearQuizProgress(progressConfig(ctx));
  match.setResumeNotice(null);
  if (settings.theme === "daily") {
    replayPublishedRound(ctx);
    return;
  }
  if (match.sessionSource !== "catalog") {
    match.setReplayStatus("legacy-repeats");
    replayPublishedRound(ctx, { replayNotice: "legacy-repeats" });
    return;
  }
  replayCatalogRound(ctx);
}
