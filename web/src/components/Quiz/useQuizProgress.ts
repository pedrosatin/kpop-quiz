import { useCallback, useEffect } from "preact/hooks";
import type { Locale, QuizSession } from "../../lib/quiz-types";
import { buildQuizProgressSave, saveQuizProgress, type QuizProgressMachineState, type QuizProgressSave } from "./storage";
import type { QuestionResult, ReplayNotice, SessionSource } from "./types";
import type { QuizMatch } from "./useQuizMatch";
import type { QuizSettings } from "./useQuizSettings";

export type QuizProgressOverrides = Partial<{
  session: QuizSession;
  sessionSource: SessionSource;
  questionIndex: number;
  selectedId: string | null;
  timedOut: boolean;
  score: number;
  revealedClues: string[];
  history: QuestionResult[];
  questionDeadlineMs: number | null;
  startedAtMs: number;
  elapsedSeconds: number;
  gaveUp: boolean;
  replayNotice: ReplayNotice;
  timerEnabled: boolean;
}>;

export type PersistProgress = (machineState: QuizProgressMachineState, overrides?: QuizProgressOverrides) => void;

/** Progress fields of a round that has just begun. */
export function freshRoundProgress(questionDeadlineMs: number | null, startedAtMs: number): QuizProgressOverrides {
  return {
    questionIndex: 0,
    selectedId: null,
    timedOut: false,
    score: 0,
    revealedClues: [],
    history: [],
    questionDeadlineMs,
    startedAtMs,
    elapsedSeconds: 0,
    gaveUp: false,
  };
}

// With `??`, a null override (selectedId, questionDeadlineMs) keeps the current
// value, so a timeout still saves the pending selection.
function progressPayload(
  locale: Locale,
  settings: QuizSettings,
  match: QuizMatch,
  machineState: QuizProgressMachineState,
  overrides: QuizProgressOverrides,
): QuizProgressSave | null {
  const session = overrides.session ?? match.session;
  if (!session) return null;
  const startedAt = overrides.startedAtMs ?? match.startTimeRef.current;
  if (startedAt === null) return null;
  return buildQuizProgressSave({
    session,
    sessionSource: overrides.sessionSource ?? match.sessionSource,
    locale,
    playMode: settings.playMode,
    theme: settings.theme,
    decades: settings.decades,
    timerEnabled: overrides.timerEnabled ?? settings.timerEnabled,
    machineState,
    questionIndex: overrides.questionIndex ?? match.questionIndex,
    selectedId: overrides.selectedId ?? match.selectedId,
    timedOut: overrides.timedOut ?? match.timedOut,
    score: overrides.score ?? match.score,
    revealedClues: overrides.revealedClues ?? match.revealedClues,
    history: overrides.history ?? match.history,
    questionDeadlineMs: overrides.questionDeadlineMs ?? (machineState === "question.ready" ? match.deadlineMs : null),
    startedAtMs: startedAt,
    elapsedSeconds: overrides.elapsedSeconds ?? match.elapsedSeconds,
    gaveUp: overrides.gaveUp ?? match.gaveUpRef.current,
    replayNotice: overrides.replayNotice ?? match.replayStatus,
  });
}

/** Writes the current round to its localStorage slot once the round may persist. */
export function useQuizProgressWriter(locale: Locale, settings: QuizSettings, match: QuizMatch): PersistProgress {
  const { playMode, theme, decades, timerEnabled } = settings;
  const {
    session, sessionSource, questionIndex, selectedId, timedOut, score, revealedClues, history,
    deadlineMs, elapsedSeconds, replayStatus, markStorageUnavailable,
  } = match;

  // The list below names every field progressPayload reads.
  return useCallback((machineState, overrides = {}) => {
    if (!match.persistReadyRef.current) return;
    const payload = progressPayload(locale, settings, match, machineState, overrides);
    if (payload && saveQuizProgress(payload) === "unavailable") markStorageUnavailable();
  }, [
    session, sessionSource, locale, playMode, theme, decades, timerEnabled,
    questionIndex, selectedId, timedOut, score, revealedClues, history,
    deadlineMs, elapsedSeconds, replayStatus, markStorageUnavailable,
  ]);
}

/** Persists a pending selection while the question is still open (not an authorization). */
export function useQuizProgressAutosave(match: QuizMatch, persistProgress: PersistProgress): void {
  const { state, session, selectedId, persistReadyRef } = match;

  useEffect(() => {
    if (!persistReadyRef.current || state !== "question.ready" || !session) return;
    persistProgress("question.ready");
  }, [selectedId, state, session, persistProgress]);
}
