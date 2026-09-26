import type { RefObject } from "preact";
import { useId, useState } from "preact/hooks";
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
  for (const evidence of evidenceItems ?? []) {
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
  actionRef?: RefObject<HTMLButtonElement> | undefined;
  answered: boolean;
  canSubmit: boolean;
  isCorrect: boolean;
  timedOut: boolean;
  selectedOption: QuizOption | null;
  correctOption: QuizOption | null;
  explanation: string;
  evidence: QuizQuestion["evidence"];
  messages: Messages;
  isLastQuestion: boolean;
  onSubmit: () => void;
  onAdvance: () => void;
}

/**
 * The quiz action bar. Before an answer it holds the hint and Submit; after
 * it, the verdict, a toggle for the explanation and sources, and Next.
 * Only the message is a live region, so buttons and links are not announced.
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
  messages,
  isLastQuestion,
  onSubmit,
  onAdvance,
}: AnswerFeedbackProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceId = useId();
  const right = answered && isCorrect && !timedOut;
  const displayedEvidence = answered ? groupEvidence(evidence) : [];

  return (
    <div class={`game-actions quiz-actions${answered ? (right ? " is-correct" : " is-incorrect") : ""}`}>
      <div class="game-actions-message" role="status" aria-live="polite">
        {answered ? (
          <p>
            <strong class="game-actions-title">
              {timedOut ? messages.timedOut : right ? messages.correct : messages.incorrect}
            </strong>
            {!right && (
              <>
                {" "}
                {!timedOut && selectedOption && (
                  <>{messages.yourAnswer}: <strong>{selectedOption.label}</strong> · </>
                )}
                {messages.answerWas}: <strong>{correctOption?.label}</strong>
              </>
            )}
          </p>
        ) : (
          <p class="game-actions-hint">{messages.chooseAnswer}</p>
        )}
      </div>
      {answered && (
        <div class="quiz-source" id={sourceId} hidden={!sourceOpen}>
          <p>{explanation}</p>
          {displayedEvidence.map((item) => (
            <p class="quiz-source-item" key={`${item.source_url}-${item.revision_id}-${item.locator}`}>
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
        </div>
      )}
      <div class="quiz-actions-buttons">
        {answered && (
          <button
            class="btn btn-secondary"
            type="button"
            aria-expanded={sourceOpen}
            aria-controls={sourceId}
            onClick={() => setSourceOpen((open) => !open)}
          >
            {messages.showSource}
          </button>
        )}
        {/* Next replaces Submit in the same spot, so the second click of a
            double click on Submit (detail 2) must not skip the verdict. */}
        {answered ? (
          <button
            key="next"
            {...(actionRef ? { ref: actionRef } : {})}
            class="btn btn-primary"
            type="button"
            onClick={(event) => { if (event.detail < 2) onAdvance(); }}
          >
            {isLastQuestion ? messages.finish : messages.next}
          </button>
        ) : (
          <button key="submit" class="btn btn-primary" type="button" disabled={!canSubmit} onClick={onSubmit}>
            {messages.check}
          </button>
        )}
      </div>
    </div>
  );
}
