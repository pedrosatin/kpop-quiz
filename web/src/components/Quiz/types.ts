import type { Locale, QuizQuestion } from "../../lib/quiz-types";
import type { QuizMatch } from "./useQuizMatch";
import type { PersistProgress } from "./useQuizProgress";
import type { QuizSettings } from "./useQuizSettings";

export type QuizMachineState =
  | "loading"
  | "setup"
  | "question.ready"
  | "question.answered"
  | "results"
  | "missing"
  | "invalid"
  | "empty"
  /** General quiz filter has fewer than ten eligible catalog questions. */
  | "unavailable";

export interface QuestionResult {
  question: QuizQuestion;
  selectedOptionId: string | null;
  isCorrect: boolean;
  cluesUsedCount: number;
}

export type SessionSource = "catalog" | "published";
/** UI notice for the next replay: catalog pool of exactly ten, or legacy fallback. */
export type ReplayNotice = "ok" | "repeats" | "legacy-repeats" | null;
export type ResumeNotice = "incompatible" | "invalid" | "storage-unavailable" | null;

/**
 * Values from one render, handed to the round actions. An action, and any
 * promise it starts, reads the state of the render that created it.
 */
export interface QuizPlayContext {
  locale: Locale;
  settings: QuizSettings;
  match: QuizMatch;
  question: QuizQuestion | undefined;
  timerSeconds: number | null;
  persistProgress: PersistProgress;
  analytics: { start: () => void; reset: () => void };
}

export interface QuizLoadContext extends QuizPlayContext {
  stopTimer: () => void;
}
