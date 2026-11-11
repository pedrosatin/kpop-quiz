import { noteDailyBoard } from "../../data/daily-artifact";
import { isQuizSession, type QuizSession } from "../../lib/quiz-types";
import { dailySeedDate } from "./daily-seed";
import { clearQuizProgress, expandHistory, type QuizProgressConfigIdentity, type QuizProgressSave } from "./storage";
import type { QuizLoadContext, QuizMachineState, QuizPlayContext, ReplayNotice, SessionSource } from "./types";
import type { QuizDecadeSelection, QuizDecadeValue } from "./url-params";
import { updateUrlParams } from "./url-params";

/** A session ready to play, with what the setup and the next replay need to know about it. */
export interface LoadedRound {
  session: QuizSession;
  availableDecades: QuizDecadeValue[];
  decades: QuizDecadeSelection;
  source: SessionSource;
  replayStatus: ReplayNotice;
}

export function progressConfig({ locale, settings }: QuizPlayContext): QuizProgressConfigIdentity {
  return { locale, playMode: settings.playMode, theme: settings.theme, decades: settings.decades };
}

export function computeDeadline(timerSeconds: number | null): number | null {
  return timerSeconds !== null ? Date.now() + timerSeconds * 1000 : null;
}

export function resetRound(
  { match, analytics }: QuizPlayContext,
  count: number,
  nextState: QuizMachineState,
  nextDeadline: number | null,
): void {
  analytics.reset();
  match.gaveUpRef.current = false;
  match.persistReadyRef.current = false;
  match.setRestoredVisit(false);
  match.setQuestionIndex(0);
  match.setSelectedId(null);
  match.setTimedOut(false);
  match.setScore(0);
  match.setRevealedClues([]);
  match.setHistory([]);
  match.setElapsedSeconds(0);
  match.answerLockedRef.current = false;
  match.setDeadlineMs(nextDeadline);
  match.setConfirmGiveUpOpen(false);
  match.confirmGiveUpOpenRef.current = false;
  match.setState(count > 0 ? nextState : "empty");
}

export function applyRestoredSave(
  ctx: QuizLoadContext,
  save: QuizProgressSave,
  available: QuizDecadeValue[],
  source: SessionSource,
): void {
  const { locale, settings, match } = ctx;
  const expanded = expandHistory(save.history, save.session);
  if (!expanded) {
    clearQuizProgress({
      locale: save.locale,
      playMode: save.play_mode,
      theme: save.theme,
      decades: save.decades,
    });
    match.setResumeNotice("invalid");
    return;
  }
  ctx.stopTimer();
  match.closeGiveUpConfirm();
  // The save holds a copy of the session: a daily one from an earlier day is
  // noted again, as the loader noted the session it matched.
  match.setSession(noteDailyBoard(save.session, dailySeedDate(save.session)));
  match.setSessionSource(source);
  match.setReplayStatus(save.replay_notice);
  settings.setAvailableDecades(available);
  match.setLoadedRequestKey(`${locale}|${save.play_mode}|${save.theme}|${save.decades.join(",")}`);
  settings.setTimerEnabled(save.timer_enabled);
  match.setQuestionIndex(Math.min(save.question_index, save.session.questions.length - 1));
  match.setSelectedId(save.selected_id);
  match.setTimedOut(save.timed_out);
  match.setScore(save.score);
  match.setRevealedClues(save.revealed_clues);
  match.setHistory(expanded);
  match.setElapsedSeconds(save.elapsed_seconds);
  match.startTimeRef.current = save.started_at_ms;
  match.gaveUpRef.current = save.gave_up;
  match.recordedMatchRef.current = null;
  match.answerLockedRef.current = save.machine_state !== "question.ready";
  match.setRestoredVisit(true);
  match.focusQuestionRef.current = false;
  match.persistReadyRef.current = true;
  match.setDeadlineMs(save.machine_state === "question.ready" ? save.question_deadline_ms : null);
  match.setState(save.machine_state);
}

export function applyRound(
  ctx: QuizLoadContext,
  round: LoadedRound,
  nextState: QuizMachineState = "setup",
): void {
  const { locale, settings, match, timerSeconds } = ctx;
  const { session, decades: loadedDecades } = round;
  if (!isQuizSession(session)) throw new Error("Invalid quiz session");
  ctx.stopTimer();
  match.setSession(session);
  match.setSessionSource(round.source);
  match.setReplayStatus(round.replayStatus);
  settings.setAvailableDecades(round.availableDecades);
  match.setLoadedRequestKey(`${locale}|${settings.playMode}|${settings.theme}|${loadedDecades.join(",")}`);
  if (loadedDecades.join(",") !== settings.decades.join(",")) {
    settings.setDecades(loadedDecades);
    updateUrlParams(settings.playMode, loadedDecades.length ? "history" : settings.theme, loadedDecades);
  }
  const nextDeadline = nextState === "question.ready" ? computeDeadline(timerSeconds) : null;
  resetRound(ctx, session.questions.length, nextState, nextDeadline);
  if (nextState === "question.ready") {
    match.persistReadyRef.current = true;
  }
}
