/**
 * Where the rating stands. A vote id means the vote was confirmed and the
 * comment step is open; `done` means the comment was confirmed too. `error`
 * holds the message of the last request that did not confirm.
 */
export type FeedbackState = { voteId: string; pending: boolean; error: string; done: boolean };

export const initialFeedbackState: FeedbackState = { voteId: "", pending: false, error: "", done: false };

export type FeedbackEvent =
  | { type: "sent" }
  | { type: "voteConfirmed"; voteId: string }
  | { type: "commentConfirmed" }
  | { type: "failed"; error: string }
  | { type: "settled" };

export function feedbackReducer(state: FeedbackState, event: FeedbackEvent): FeedbackState {
  switch (event.type) {
    case "sent":
      return { ...state, pending: true, error: "" };
    case "voteConfirmed":
      return { ...state, voteId: event.voteId };
    case "commentConfirmed":
      return { ...state, done: true };
    case "failed":
      return { ...state, error: event.error };
    case "settled":
      return { ...state, pending: false };
  }
}

/** The player can retry a vote until the service confirms one. */
export function canVote(state: FeedbackState): boolean {
  return !state.voteId;
}

/** A comment needs a confirmed vote, some text and no request in flight. */
export function canSendComment(state: FeedbackState, comment: string): boolean {
  return Boolean(state.voteId) && Boolean(comment) && !state.pending;
}
