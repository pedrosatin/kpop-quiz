import { computeAwardedPoints } from "./scoring";
import { computeDeadline } from "./quiz-round-state";
import { saveStoredPlayMode, saveStoredTimerEnabled } from "./storage";
import type { QuestionResult, QuizPlayContext } from "./types";
import type { QuizMatch } from "./useQuizMatch";
import { freshRoundProgress } from "./useQuizProgress";
import { updateUrlParams } from "./url-params";

function isLastQuestion({ session, questionIndex }: QuizMatch): boolean {
  return questionIndex === (session?.questions.length ?? 0) - 1;
}

/** Stores the measured round time when `measure` allows it; returns the value to persist. */
function settleElapsed(match: QuizMatch, measure: boolean): number {
  const { startTimeRef, elapsedSeconds, setElapsedSeconds } = match;
  if (!measure || !startTimeRef.current) return elapsedSeconds;
  const elapsed = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
  setElapsedSeconds(elapsed);
  return elapsed;
}

export function startRound(ctx: QuizPlayContext): void {
  const { analytics, settings, match, timerSeconds, persistProgress } = ctx;
  analytics.start();
  saveStoredPlayMode(settings.playMode);
  saveStoredTimerEnabled(settings.timerEnabled);
  updateUrlParams(settings.playMode, settings.theme, settings.decades);
  match.focusQuestionRef.current = true;
  match.setRestoredVisit(false);
  const startedAt = Date.now();
  match.startTimeRef.current = startedAt;
  const nextDeadline = computeDeadline(timerSeconds);
  match.setDeadlineMs(nextDeadline);
  match.setState("question.ready");
  match.persistReadyRef.current = true;
  persistProgress("question.ready", freshRoundProgress(nextDeadline, startedAt));
}

/** Timeout applies the normal rule once and drops any pending give-up confirm. */
export function expireQuestion({ match, question, persistProgress }: QuizPlayContext): void {
  const { history, revealedClues } = match;
  match.closeGiveUpConfirm();
  match.answerLockedRef.current = true;
  match.setTimedOut(true);
  match.setDeadlineMs(null);
  const nextHistory = question
    ? [...history, { question, selectedOptionId: null, isCorrect: false, cluesUsedCount: revealedClues.length }]
    : history;
  const nextElapsed = settleElapsed(match, isLastQuestion(match));
  match.setHistory(nextHistory);
  match.setState("question.answered");
  persistProgress("question.answered", {
    timedOut: true,
    selectedId: null,
    history: nextHistory,
    questionDeadlineMs: null,
    elapsedSeconds: nextElapsed,
  });
}

export function submitAnswer({ match, question, persistProgress, analytics }: QuizPlayContext): void {
  const { selectedId, score, revealedClues, history, answerLockedRef } = match;
  if (!question || !selectedId || answerLockedRef.current) return;
  analytics.start();
  answerLockedRef.current = true;
  match.setDeadlineMs(null);
  const isCorrect = selectedId === question.answer_option_id;
  const nextScore = isCorrect ? score + computeAwardedPoints(question, revealedClues) : score;
  if (isCorrect) match.setScore(nextScore);
  const nextHistory = [
    ...history,
    { question, selectedOptionId: selectedId, isCorrect, cluesUsedCount: revealedClues.length },
  ];
  const nextElapsed = settleElapsed(match, isLastQuestion(match));
  match.setHistory(nextHistory);
  match.setState("question.answered");
  persistProgress("question.answered", {
    score: nextScore,
    history: nextHistory,
    questionDeadlineMs: null,
    elapsedSeconds: nextElapsed,
  });
}

function showResults({ match, persistProgress }: QuizPlayContext): void {
  const nextElapsed = settleElapsed(match, match.elapsedSeconds === 0);
  match.setState("results");
  persistProgress("results", {
    questionDeadlineMs: null,
    elapsedSeconds: nextElapsed,
  });
}

export function advanceRound(ctx: QuizPlayContext): void {
  const { match, timerSeconds, persistProgress, analytics } = ctx;
  if (!match.session) return;
  analytics.start();
  if (match.questionIndex === match.session.questions.length - 1) {
    showResults(ctx);
    return;
  }
  match.answerLockedRef.current = false;
  match.focusQuestionRef.current = true;
  match.setRestoredVisit(false);
  const nextIndex = match.questionIndex + 1;
  const nextDeadline = computeDeadline(timerSeconds);
  match.setQuestionIndex(nextIndex);
  match.setSelectedId(null);
  match.setTimedOut(false);
  match.setRevealedClues([]);
  match.setDeadlineMs(nextDeadline);
  match.setState("question.ready");
  persistProgress("question.ready", {
    questionIndex: nextIndex,
    selectedId: null,
    timedOut: false,
    revealedClues: [],
    questionDeadlineMs: nextDeadline,
  });
}

function giveUp({ match, question, persistProgress, analytics }: QuizPlayContext): void {
  const { session, state, questionIndex, revealedClues, history, gaveUpRef } = match;
  if (!session || state === "results" || gaveUpRef.current) return;
  // A restored round never passes through start(), so its result would go unsent.
  analytics.start();
  gaveUpRef.current = true;
  match.setDeadlineMs(null);
  match.answerLockedRef.current = true;
  const extra: QuestionResult[] = [];
  if (state !== "question.answered" && question) {
    extra.push({ question, selectedOptionId: null, isCorrect: false, cluesUsedCount: revealedClues.length });
  }
  // The current question is already in history when answered (submit
  // recorded it) or pushed above when not, so the loop always resumes
  // after it.
  for (let i = questionIndex + 1; i < session.questions.length; i++) {
    extra.push({ question: session.questions[i]!, selectedOptionId: null, isCorrect: false, cluesUsedCount: 0 });
  }
  const nextHistory = [...history, ...extra];
  const nextElapsed = settleElapsed(match, true);
  match.setHistory(nextHistory);
  match.setState("results");
  persistProgress("results", {
    history: nextHistory,
    questionDeadlineMs: null,
    elapsedSeconds: nextElapsed,
    gaveUp: true,
  });
}

/** Open confirmation is never persisted as an authorized action. */
export function requestGiveUp({ confirmGiveUpOpenRef, setConfirmGiveUpOpen }: QuizMatch): void {
  confirmGiveUpOpenRef.current = true;
  setConfirmGiveUpOpen(true);
}

export function confirmGiveUp(ctx: QuizPlayContext): void {
  // A delayed click after timeout (or Escape) must not end the round.
  if (!ctx.match.confirmGiveUpOpenRef.current) return;
  ctx.match.closeGiveUpConfirm();
  giveUp(ctx);
}

export function revealClue({ match, question, persistProgress }: QuizPlayContext): void {
  if (!question) return;
  const next = question.clues_available.find((c) => !match.revealedClues.includes(c.id));
  if (!next) return;
  const nextClues = [...match.revealedClues, next.id];
  match.setRevealedClues(nextClues);
  persistProgress("question.ready", { revealedClues: nextClues });
}
