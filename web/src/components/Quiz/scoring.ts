import type { QuizQuestion } from "../../lib/quiz-types";

export function computeAwardedPoints(
  question: QuizQuestion,
  revealedClues: string[],
): number {
  const revealedCount = new Set(
    revealedClues.filter((id) => !question.clues_shown.includes(id))
  ).size;
  const cost = revealedCount * question.hint_cost;
  return Math.max(0, question.base_points - cost);
}
