import { describe, expect, it } from "vitest";
import { canSendComment, canVote, feedbackReducer, initialFeedbackState, type FeedbackState } from "./feedback-state";

const voted: FeedbackState = { ...initialFeedbackState, voteId: "vote-id" };

describe("feedbackReducer", () => {
  it("marks a request in flight and hides the last error", () => {
    expect(feedbackReducer({ ...initialFeedbackState, error: "old" }, { type: "sent" })).toStrictEqual({ ...initialFeedbackState, pending: true });
  });

  it("opens the comment step with the confirmed vote id", () => {
    expect(feedbackReducer({ ...initialFeedbackState, pending: true }, { type: "voteConfirmed", voteId: "vote-id" })).toStrictEqual({ ...voted, pending: true });
  });

  it("finishes once the comment is confirmed", () => {
    expect(feedbackReducer(voted, { type: "commentConfirmed" })).toStrictEqual({ ...voted, done: true });
  });

  it("keeps the vote id when a comment fails", () => {
    expect(feedbackReducer({ ...voted, pending: true }, { type: "failed", error: "no" })).toStrictEqual({ ...voted, pending: true, error: "no" });
  });

  it("clears the request in flight and keeps the error", () => {
    expect(feedbackReducer({ ...voted, pending: true, error: "no" }, { type: "settled" })).toStrictEqual({ ...voted, error: "no" });
  });
});

describe("canVote", () => {
  it("allows a vote, or a retry, until one is confirmed", () => {
    expect(canVote(initialFeedbackState)).toBe(true);
    expect(canVote({ ...initialFeedbackState, error: "no" })).toBe(true);
    expect(canVote(voted)).toBe(false);
  });
});

describe("canSendComment", () => {
  it("needs a confirmed vote, some text and no request in flight", () => {
    expect(canSendComment(voted, "Adorei")).toBe(true);
    expect(canSendComment(initialFeedbackState, "Adorei")).toBe(false);
    expect(canSendComment(voted, "")).toBe(false);
    expect(canSendComment({ ...voted, pending: true }, "Adorei")).toBe(false);
  });
});
