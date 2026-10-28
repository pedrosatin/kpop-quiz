import type { QuizQuestion } from "../../lib/quiz-types";

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

