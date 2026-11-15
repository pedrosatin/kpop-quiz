import { isRecord } from "../../lib/guards";
import type { Locale } from "../../lib/quiz-types";

export const RATING_API = "https://tbbc.app/api/rating";
/** The rating service gives up on its side long before this. */
export const RATING_TIMEOUT_MS = 10000;
/** A new vote answers 201 and a comment on it answers 200. */
export const VOTE_CREATED = 201;
export const COMMENT_SAVED = 200;

export type CommentAttempt = { comment: string; nonce: string };

/** Only generic metadata goes with a vote: no score, round or player data. */
export function voteBody(site: string, vote: 1 | -1, locale: Locale) {
  return { site, vote, section: "quiz-result", app: "ponder-club", lang: locale === "pt-BR" ? "pt-BR" : "en" };
}

/** A comment goes to the vote it belongs to. */
export function commentPath(voteId: string): string {
  return `/${encodeURIComponent(voteId)}`;
}

/**
 * Retrying the same text keeps its nonce, so the service can drop a comment
 * it already saved. Edited text is a new comment with a new nonce.
 */
export function nextCommentAttempt(previous: CommentAttempt | null, comment: string, newNonce: () => string): CommentAttempt {
  if (previous?.comment === comment) return previous;
  return { comment, nonce: newNonce() };
}

/**
 * A reply confirms only with the expected status, `ok: true` and a non-blank
 * id. A comment reply must also name the vote it was sent to; a vote reply
 * passes an empty `voteId` and accepts any id.
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
