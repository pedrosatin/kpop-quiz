import { isRecord } from "../../lib/guards";
import type { Locale } from "../../lib/quiz-types";

export const RATING_API = "https://tbbc.app/api/rating";
/** The widget aborts a request that takes longer than this. */
export const RATING_TIMEOUT_MS = 10000;
/** The service answers 201 to a new vote and 200 to a comment on it. */
export const VOTE_CREATED = 201;
export const COMMENT_SAVED = 200;

export type CommentAttempt = { comment: string; nonce: string };

/**
 * A vote carries the site key, the vote, a fixed section and app, and the
 * language. Score, round and player data stay out.
 */
export function voteBody(site: string, vote: 1 | -1, locale: Locale) {
  return { site, vote, section: "quiz-result", app: "ponder-club", lang: locale === "pt-BR" ? "pt-BR" : "en" };
}

/** A comment goes to the vote it belongs to. */
export function commentPath(voteId: string): string {
  return `/${encodeURIComponent(voteId)}`;
}

/**
 * Retrying the same text keeps its nonce, so the service can tell a retry
 * from a new comment. Edited text is a new comment with a new nonce.
 */
export function nextCommentAttempt(previous: CommentAttempt | null, comment: string, newNonce: () => string): CommentAttempt {
  if (previous?.comment === comment) return previous;
  return { comment, nonce: newNonce() };
}

/**
 * A reply confirms only with the expected status, `ok: true` and a non-blank
 * id. A comment reply must also name the vote it was sent to. For a vote, the
 * caller passes an empty `voteId`, and any id confirms.
 */
export function isConfirmedReply(status: number, reply: unknown, expected: { status: number; voteId: string }): reply is { ok: true; id: string } {
  if (status !== expected.status) return false;
  if (!isRecord(reply) || reply.ok !== true) return false;
  if (typeof reply.id !== "string" || !reply.id.trim()) return false;
  return !expected.voteId || reply.id === expected.voteId;
}

/** The rating service gets no cookies and no referrer. */
export function postRating(path: string, body: object, signal: AbortSignal): Promise<Response> {
  return fetch(RATING_API + path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal, body: JSON.stringify(body) });
}
