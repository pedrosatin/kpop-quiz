import type { FeedbackCopy } from "./feedback-copy";

export function FeedbackVoteButtons({ t, pending, onVote, onDismiss }: { t: FeedbackCopy; pending: boolean; onVote: (vote: 1 | -1) => void; onDismiss: () => void }) {
  return (
    <div class="btn-row">
      <button class="btn btn-secondary" disabled={pending} onClick={() => onVote(1)}>{t.yes}</button>
      <button class="btn btn-secondary" disabled={pending} onClick={() => onVote(-1)}>{t.no}</button>
      <button class="btn btn-secondary" disabled={pending} onClick={onDismiss}>{t.dismiss}</button>
    </div>
  );
}
