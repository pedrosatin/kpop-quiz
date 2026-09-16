import type { QuizQuestion } from "../../lib/quiz-types";

export type QuizMachineState =
  | "loading"
  | "setup"
  | "question.ready"
  | "question.answered"
  | "results"
  | "missing"
  | "invalid"
  | "empty";

export interface QuestionResult {
  question: QuizQuestion;
  selectedOptionId: string | null;
  isCorrect: boolean;
  cluesUsedCount: number;
}

