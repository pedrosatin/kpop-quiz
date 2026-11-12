import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Messages } from "../../i18n/catalog";
import type { DisplayEvidence } from "./answer-evidence";
import { SourceCitation } from "../Source/SourceCitation";

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
  const panel = useRef<HTMLDivElement>(null);
  // On phones the open panel grows the round past the screen; bring the bar
  // into view so the panel and Next show together when they fit.
  useEffect(() => {
    if (sourceOpen) panel.current?.closest(".game-actions")?.scrollIntoView?.({ block: "nearest" });
  }, [sourceOpen]);

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
      <div ref={panel} class="quiz-source source-panel" id={sourceId} hidden={!sourceOpen}>
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
      <SourceCitation url={item.source_url} revision={item.revision_id} locator={item.locator} messages={messages}>
        {item.declaredReference && (
          <> {messages.declaredReference}: {item.declaredReference}.</>
        )}
      </SourceCitation>
    </p>
  );
}
