import type { RefObject } from "preact";
import type { Locale } from "../../lib/quiz-types";
import { feedbackCopy, type FeedbackCopy } from "./feedback-copy";
import { FeedbackCommentForm } from "./feedback-comment-form";
import type { FeedbackState } from "./feedback-state";
import { FeedbackVoteButtons } from "./feedback-vote-buttons";
import { useFeedback } from "./useFeedback";

export function Feedback({ locale, site = import.meta.env.PUBLIC_TBBC_SITE_KEY || "" }: { locale: Locale; site?: string }) {
  const t = feedbackCopy[locale];
  const { visible, state, value, setValue, commentInput, vote, comment, dismiss } = useFeedback(locale, site);
  if (!visible || !site) return null;
  return (
    <section class="feedback" aria-label={t.question}>
      {state.done ? (
        <p role="status">{t.thanks}</p>
      ) : (
        <FeedbackPrompt t={t} state={state} value={value} commentInput={commentInput} onVote={vote} onInput={setValue} onComment={comment} onDismiss={dismiss} />
      )}
    </section>
  );
}

/** The vote, then the optional comment, with the error of the last attempt. */
function FeedbackPrompt({
  t,
  state,
  value,
  commentInput,
  onVote,
  onInput,
  onComment,
  onDismiss,
}: {
  t: FeedbackCopy;
  state: FeedbackState;
  value: string;
  commentInput: RefObject<HTMLTextAreaElement>;
  onVote: (vote: 1 | -1) => void;
  onInput: (value: string) => void;
  onComment: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <h3>{t.question}</h3>
      <p>{t.notice}</p>
      {state.voteId ? (
        <FeedbackCommentForm t={t} value={value} pending={state.pending} inputRef={commentInput} onInput={onInput} onSend={onComment} onSkip={onDismiss} />
      ) : (
        <FeedbackVoteButtons t={t} pending={state.pending} onVote={onVote} onDismiss={onDismiss} />
      )}
      {state.error && <p role="alert">{state.error}</p>}
    </>
  );
}
