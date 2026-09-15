import type { RefObject } from "preact";
import type { Messages } from "../../i18n/catalog";

export interface QuizResultProps {
  score: number;
  messages: Messages;
  headingRef?: RefObject<HTMLHeadingElement>;
  onRestart: () => void;
}

export function QuizResult({
  score,
  messages,
  headingRef,
  onRestart,
}: QuizResultProps) {
  return (
    <section id="quiz" class="quiz-card result" aria-labelledby="result-heading">
      <p class="kicker">{messages.score}</p>
      <h2 id="result-heading" {...(headingRef ? { ref: headingRef } : {})} tabIndex={-1}>
        {messages.resultTitle}
      </h2>
      <p class="result-score">
        <strong>{score}</strong>
        <span> {messages.points}</span>
      </p>
      <p>{messages.resultText(score)}</p>
      <button class="primary-action" type="button" onClick={onRestart}>
        {messages.restart}
      </button>
    </section>
  );
}
