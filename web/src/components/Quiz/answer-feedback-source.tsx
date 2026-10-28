import type { ComponentChildren } from "preact";
import type { Messages } from "../../i18n/catalog";
import type { DisplayEvidence } from "./answer-evidence";

export function AnswerFeedbackSource({
  sourceOpen,
  sourceId,
  answers,
  explanation,
  evidence,
  clues = [],
  messages,
  onToggle,
}: {
  sourceOpen: boolean;
  sourceId: string;
  answers: ComponentChildren;
  explanation: string;
  evidence: DisplayEvidence[];
  clues?: { text: string; evidence: DisplayEvidence[] }[];
  messages: Messages;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        class="btn btn-secondary"
        type="button"
        aria-expanded={sourceOpen}
        aria-controls={sourceId}
        onClick={onToggle}
      >
        {sourceOpen ? messages.hideSource : messages.showSource}
      </button>
      <div class="quiz-source" id={sourceId} hidden={!sourceOpen} tabIndex={0}>
        {/* The bar clamps the verdict to two lines; the full answers stay here. */}
        {answers && <p>{answers}</p>}
        <p>{explanation}</p>
        {evidence.map((item) => (
          <SourceItem key={`${item.source_url}-${item.revision_id}-${item.locator}`} item={item} messages={messages} />
        ))}
        {clues.map((clue) => (
          <div class="quiz-source-clue" data-testid="quiz-clue-source" key={clue.text}>
            <p><strong>{messages.clue}:</strong> {clue.text}</p>
            {clue.evidence.map((item) => (
              <SourceItem key={`${item.source_url}-${item.revision_id}-${item.locator}`} item={item} messages={messages} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function SourceItem({ item, messages }: { item: DisplayEvidence; messages: Messages }) {
  return (
    <p class="quiz-source-item">
      {item.project}, {messages.revision} {item.revision_id}.
      {item.declaredReference && (
        <> {messages.declaredReference}: {item.declaredReference}.</>
      )}
      {" "}
      <a href={item.source_url} target="_blank" rel="noreferrer">
        {messages.openRevision(item.project)}
      </a>
    </p>
  );
}
