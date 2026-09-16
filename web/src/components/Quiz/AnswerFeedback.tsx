import type { RefObject } from "preact";
import type { QuizOption, QuizQuestion } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export interface DisplayEvidence {
  source_url: string;
  revision_id: number;
  locator: string;
  project: "Wikidata" | "Wikipedia";
  declaredReference: string | null;
}

export function groupEvidence(evidenceItems: QuizQuestion["evidence"]): DisplayEvidence[] {
  const groups = new Map<string, DisplayEvidence>();
  for (const evidence of evidenceItems) {
    const key = `${evidence.source_url}\u0000${evidence.revision_id}\u0000${evidence.locator}`;
    if (groups.has(key)) continue;
    const wikidata = new URL(evidence.source_url).hostname === "www.wikidata.org";
    groups.set(key, {
      source_url: evidence.source_url,
      revision_id: evidence.revision_id,
      locator: evidence.locator,
      project: wikidata ? "Wikidata" : "Wikipedia",
      declaredReference:
        wikidata && evidence.source_key.startsWith("domain:")
          ? evidence.source_key.slice("domain:".length)
          : null,
    });
  }
  return [...groups.values()];
}

export interface AnswerFeedbackProps {
  feedbackRef?: RefObject<HTMLDivElement>;
  isCorrect: boolean;
  timedOut: boolean;
  correctOption: QuizOption | null;
  explanation: string;
  evidence: QuizQuestion["evidence"];
  messages: Messages;
  isLastQuestion: boolean;
  onAdvance: () => void;
}

export function AnswerFeedback({
  feedbackRef,
  isCorrect,
  timedOut,
  correctOption,
  explanation,
  evidence,
  messages,
  isLastQuestion,
  onAdvance,
}: AnswerFeedbackProps) {
  const displayedEvidence = groupEvidence(evidence);

  return (
    <div class="feedback" {...(feedbackRef ? { ref: feedbackRef } : {})} tabIndex={-1} role="status">
      <p class={`feedback-title ${isCorrect && !timedOut ? "success" : "failure"}`}>
        {timedOut ? messages.timedOut : isCorrect ? messages.correct : messages.incorrect}
      </p>
      {(!isCorrect || timedOut) && (
        <p>
          {messages.answerWas}: <strong>{correctOption?.label}</strong>
        </p>
      )}
      <p>{explanation}</p>
      <details>
        <summary>{messages.evidence}</summary>
        {displayedEvidence.map((item) => (
          <p key={`${item.source_url}-${item.revision_id}-${item.locator}`}>
            {item.project}, {messages.revision} {item.revision_id}.
            {item.declaredReference && (
              <> {messages.declaredReference}: {item.declaredReference}.</>
            )}
            {" "}
            <a href={item.source_url} target="_blank" rel="noreferrer">
              {messages.openRevision(item.project)}
            </a>
          </p>
        ))}
      </details>
      <button class="primary-action" type="button" onClick={onAdvance}>
        {isLastQuestion ? messages.finish : messages.next}
      </button>
    </div>
  );
}
