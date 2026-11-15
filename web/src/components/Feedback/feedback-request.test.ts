import { describe, expect, it, vi } from "vitest";
import { COMMENT_SAVED, VOTE_CREATED, commentPath, isConfirmedReply, nextCommentAttempt, voteBody } from "./feedback-request";

describe("voteBody", () => {
  it.each([
    ["pt-BR", 1],
    ["en", -1],
  ] as const)("sends only generic metadata for a %s vote", (locale, vote) => {
    expect(voteBody("k_test", vote, locale)).toStrictEqual({ site: "k_test", vote, section: "quiz-result", app: "ponder-club", lang: locale });
  });
});

describe("commentPath", () => {
  it("encodes the vote id as one path segment", () => {
    expect(commentPath("vote id/1?x")).toBe("/vote%20id%2F1%3Fx");
  });
});

describe("nextCommentAttempt", () => {
  it("creates the first attempt with a new nonce", () => {
    expect(nextCommentAttempt(null, "Adorei", () => "n1")).toStrictEqual({ comment: "Adorei", nonce: "n1" });
  });

  it("keeps the nonce when the same text is sent again", () => {
    const previous = { comment: "Adorei", nonce: "n1" };
    const newNonce = vi.fn(() => "n2");
    expect(nextCommentAttempt(previous, "Adorei", newNonce)).toBe(previous);
    expect(newNonce).not.toHaveBeenCalled();
  });

  it("gives edited text a new nonce", () => {
    expect(nextCommentAttempt({ comment: "Adorei", nonce: "n1" }, "Amei", () => "n2")).toStrictEqual({ comment: "Amei", nonce: "n2" });
  });
});

describe("isConfirmedReply", () => {
  const vote = { status: VOTE_CREATED, voteId: "" };
  const comment = { status: COMMENT_SAVED, voteId: "vote-id" };

  it("confirms a vote with any non-blank id", () => {
    expect(isConfirmedReply(201, { ok: true, id: "any" }, vote)).toBe(true);
  });

  it("confirms a comment that names its vote", () => {
    expect(isConfirmedReply(200, { ok: true, id: "vote-id" }, comment)).toBe(true);
  });

  it.each([
    ["another status", 200, { ok: true, id: "vote-id" }],
    ["ok other than true", 201, { ok: 1, id: "vote-id" }],
    ["no id", 201, { ok: true }],
    ["a blank id", 201, { ok: true, id: " \n " }],
    ["an id that is not text", 201, { ok: true, id: 7 }],
    ["a null reply", 201, null],
    ["a text reply", 201, "ok"],
    ["an array reply", 201, [true]],
  ])("does not confirm a vote with %s", (_case, status, reply) => {
    expect(isConfirmedReply(status, reply, vote)).toBe(false);
  });

  it("does not confirm a comment saved on another vote", () => {
    expect(isConfirmedReply(200, { ok: true, id: "other-id" }, comment)).toBe(false);
  });
});
