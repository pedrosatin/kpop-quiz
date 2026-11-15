import type { RefObject } from "preact";
import type { FeedbackCopy } from "./feedback-copy";

export function FeedbackCommentForm({
  t,
  value,
  pending,
  inputRef,
  onInput,
  onSend,
  onSkip,
}: {
  t: FeedbackCopy;
  value: string;
  pending: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  onInput: (value: string) => void;
  onSend: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <label for="feedback-comment">{t.comment}</label>
      <textarea ref={inputRef} id="feedback-comment" maxLength={1000} value={value} onInput={(event) => onInput(event.currentTarget.value)} disabled={pending} />
      <div class="btn-row">
        <button class="btn btn-secondary" disabled={pending || !value.trim()} onClick={onSend}>{t.send}</button>
        <button class="btn btn-secondary" disabled={pending} onClick={onSkip}>{t.skip}</button>
      </div>
    </>
  );
}
