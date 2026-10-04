import type { RefObject } from "preact";
import type { Messages } from "../../i18n/catalog";
import { NEXT_GUARD_MS } from "./answer-feedback-constants";

export function AnswerFeedbackActions({
  answered,
  canSubmit,
  isLastQuestion,
  actionRef,
  nextShownAt,
  messages,
  onSubmit,
  onAdvance,
}: {
  answered: boolean;
  canSubmit: boolean;
  isLastQuestion: boolean;
  actionRef?: RefObject<HTMLButtonElement> | undefined;
  nextShownAt: { current: number };
  messages: Messages;
  onSubmit: () => void;
  onAdvance: () => void;
}) {
  if (!answered) {
    return (
      <button key="submit" class="btn btn-primary" type="button" disabled={!canSubmit} onClick={onSubmit}>
        {messages.check}
      </button>
    );
  }

  return (
    <button
      key="next"
      {...(actionRef ? { ref: actionRef } : {})}
      class="btn btn-primary"
      type="button"
      onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
      onClick={() => {
        if (performance.now() - nextShownAt.current >= NEXT_GUARD_MS) onAdvance();
      }}
    >
      {isLastQuestion ? messages.finish : messages.next}
    </button>
  );
}
