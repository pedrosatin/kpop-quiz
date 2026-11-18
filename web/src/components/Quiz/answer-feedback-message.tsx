import type { ComponentChildren } from "preact";
import type { QuizOption } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export function quizBarState(answered: boolean, right: boolean): string {
  if (!answered) return "";
  return right ? " is-correct" : " is-incorrect";
}

/**
 * Opt-in kind for the shared feedback motion CSS. Setting `data-feedback` on
 * `.game-actions` selects the correct/incorrect keyframes; other games keep
 * `is-correct` / `is-incorrect` for color without animating.
 */
export function quizFeedbackKind(
  answered: boolean,
  right: boolean,
): "correct" | "incorrect" | null {
  if (!answered) return null;
  return right ? "correct" : "incorrect";
}

/** Player and correct answers shown beside the verdict and again in the source panel. */
export function AnswerSummary({
  timedOut,
  selectedOption,
  correctOption,
  messages,
}: {
  timedOut: boolean;
  selectedOption: QuizOption | null;
  correctOption: QuizOption | null;
  messages: Messages;
}) {
  return (
    <>
      {!timedOut && selectedOption && (
        <>{messages.yourAnswer}: <strong>{selectedOption.label}</strong> · </>
      )}
      {messages.answerWas}: <strong>{correctOption?.label}</strong>
    </>
  );
}

export function AnswerFeedbackMessage({
  answered,
  right,
  timedOut,
  answers,
  messages,
}: {
  answered: boolean;
  right: boolean;
  timedOut: boolean;
  answers: ComponentChildren;
  messages: Messages;
}) {
  if (!answered) {
    return <p class="game-actions-hint">{messages.submitHint}</p>;
  }

  const title = timedOut ? messages.timedOut : right ? messages.correct : messages.incorrect;
  // Mark is decorative; the live region already announces the title text.
  // U+FE0E keeps the stopwatch as text (not a colored emoji); ✓/✗ inherit title color.
  const mark = right ? "✓" : timedOut ? "⏱\uFE0E" : "✗";
  return (
    <p class="quiz-verdict">
      <span class="feedback-mark" aria-hidden="true">{mark}</span>
      <strong class="game-actions-title">{title}</strong>
      {answers && <>{" "}{answers}</>}
    </p>
  );
}
