import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";
import type { Locale } from "../../lib/quiz-types";
import { feedbackCopy } from "./feedback-copy";
import { COMMENT_SAVED, RATING_TIMEOUT_MS, VOTE_CREATED, commentPath, isConfirmedReply, nextCommentAttempt, postRating, voteBody, type CommentAttempt } from "./feedback-request";
import { canSendComment, canVote, feedbackReducer, initialFeedbackState } from "./feedback-state";
import { useCommentFocus } from "./useCommentFocus";

/**
 * Set when the service confirms a vote or a comment, or when the player
 * dismisses, so later results do not ask again.
 */
const STORAGE = "ponder-feedback-dismissed";

/** Visibility, the typed comment and the rating requests of the widget. */
export function useFeedback(locale: Locale, site: string) {
  const t = feedbackCopy[locale];
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const [state, dispatch] = useReducer(feedbackReducer, initialFeedbackState);
  const request = useRef<AbortController | null>(null);
  const attempt = useRef<CommentAttempt | null>(null);
  // Unusable storage reads as "not dismissed", so the widget still asks.
  useEffect(() => {
    setVisible(Boolean(site) && getLocalStorageItem(STORAGE) !== "1");
    return () => { const current = request.current; request.current = null; current?.abort(); };
  }, [site]);
  const { commentInput, voteControl } = useCommentFocus(state.voteId, state.pending);

  function dismiss() {
    setLocalStorageItem(STORAGE, "1");
    setVisible(false);
  }

  // One request at a time. A reply that arrives after the widget is gone, or
  // after a newer request took over, changes nothing.
  async function send(path: string, body: object, expected: { status: number; voteId: string }, accept: (voteId: string) => void, failure: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), RATING_TIMEOUT_MS);
    dispatch({ type: "sent" });
    try {
      const response = await postRating(path, body, controller.signal);
      const reply: unknown = await response.json();
      if (controller.signal.aborted || !isConfirmedReply(response.status, reply, expected)) throw new Error("unconfirmed");
      if (request.current === controller) accept(reply.id);
    } catch {
      if (request.current === controller) dispatch({ type: "failed", error: failure });
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; dispatch({ type: "settled" }); }
    }
  }

  function vote(vote: 1 | -1) {
    if (!canVote(state)) return;
    voteControl.current = document.activeElement;
    void send("", voteBody(site, vote, locale), { status: VOTE_CREATED, voteId: "" }, (voteId) => {
      dispatch({ type: "voteConfirmed", voteId });
      setLocalStorageItem(STORAGE, "1");
    }, t.voteError);
  }

  function comment() {
    const text = value.trim();
    if (!canSendComment(state, text)) return;
    attempt.current = nextCommentAttempt(attempt.current, text, () => crypto.randomUUID());
    void send(commentPath(state.voteId), attempt.current, { status: COMMENT_SAVED, voteId: state.voteId }, () => {
      dispatch({ type: "commentConfirmed" });
      setLocalStorageItem(STORAGE, "1");
    }, t.commentError);
  }

  return { visible, state, value, setValue, commentInput, vote, comment, dismiss };
}
