import type { RefObject } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { QuizClue, QuizOption, QuizQuestion } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { AnswerFeedbackActions } from "./answer-feedback-actions";
import {
  AnswerFeedbackMessage,
  AnswerSummary,
  quizBarState,
} from "./answer-feedback-message";
import { AnswerFeedbackSource } from "./answer-feedback-source";
import { groupEvidence } from "./answer-evidence";

export type { DisplayEvidence } from "./answer-evidence";
export { groupEvidence } from "./answer-evidence";
export { NEXT_GUARD_MS } from "./answer-feedback-constants";

export interface AnswerFeedbackProps {
  actionRef?: RefObject<HTMLButtonElement> | undefined;
  answered: boolean;
  canSubmit: boolean;
  isCorrect: boolean;
  timedOut: boolean;
  selectedOption: QuizOption | null;
  correctOption: QuizOption | null;
  explanation: string;
  evidence: QuizQuestion["evidence"];
  /** Clues the player saw; their sources are listed beside the answer's. */
  seenClues?: QuizClue[] | undefined;
  messages: Messages;
  isLastQuestion: boolean;
  onSubmit: () => void;
  onAdvance: () => void;
  onGiveUp?: (() => void) | undefined;
}

/**
 * The quiz action bar. Before an answer it holds the hint and Submit; after
 * it, the verdict, a toggle for the explanation and sources, and Next.
 * Only the message is a live region, so buttons and links are not announced.
 * The message and the sources panel are keyboard-focusable scroll regions in
 * DOM order, so Tab reaches each region before the controls that follow it.
 * Mount it with a key per question so the sources start closed.
 */
export function AnswerFeedback({
  actionRef,
  answered,
  canSubmit,
  isCorrect,
  timedOut,
  selectedOption,
  correctOption,
  explanation,
  evidence,
  seenClues = [],
  messages,
  isLastQuestion,
  onSubmit,
  onAdvance,
  onGiveUp,
}: AnswerFeedbackProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceId = useId();
  const nextShownAt = useRef(0);
  const right = answered && isCorrect && !timedOut;
  const displayedEvidence = answered ? groupEvidence(evidence) : [];
  const displayedClues = answered
    ? seenClues.map((clue) => ({ text: clue.text, evidence: groupEvidence(clue.evidence) }))
    : [];

  // Next replaces Submit in the same spot, so a second click or a held Enter
  // meant for Submit must not skip the verdict.
  useLayoutEffect(() => {
    if (answered) nextShownAt.current = performance.now();
  }, [answered]);

  const answers = !right && (
    <AnswerSummary
      timedOut={timedOut}
      selectedOption={selectedOption}
      correctOption={correctOption}
      messages={messages}
    />
  );

  return (
    <div class={`game-actions quiz-actions${quizBarState(answered, right)}`}>
      <div class="game-actions-message" role="status" aria-live="polite" tabIndex={0}>
        <AnswerFeedbackMessage
          answered={answered}
          right={right}
          timedOut={timedOut}
          answers={answers}
          messages={messages}
        />
      </div>
      <div class="quiz-actions-buttons">
        {answered && (
          <AnswerFeedbackSource
            sourceOpen={sourceOpen}
            sourceId={sourceId}
            answers={answers}
            explanation={explanation}
            evidence={displayedEvidence}
            clues={displayedClues}
            messages={messages}
            onToggle={() => setSourceOpen((open) => !open)}
          />
        )}
        <AnswerFeedbackActions
          answered={answered}
          canSubmit={canSubmit}
          isLastQuestion={isLastQuestion}
          actionRef={actionRef}
          nextShownAt={nextShownAt}
          messages={messages}
          onSubmit={onSubmit}
          onAdvance={onAdvance}
          onGiveUp={onGiveUp}
        />
      </div>
    </div>
  );
}
