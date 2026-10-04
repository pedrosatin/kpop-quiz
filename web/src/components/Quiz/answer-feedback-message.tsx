import type { ComponentChildren } from "preact";
import type { QuizOption } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export function quizBarState(answered: boolean, right: boolean): string {
  if (!answered) return "";
  return right ? " is-correct" : " is-incorrect";
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
  return (
    <p class="quiz-verdict">
      <strong class="game-actions-title">{title}</strong>
      {answers && <>{" "}{answers}</>}
    </p>
  );
}
