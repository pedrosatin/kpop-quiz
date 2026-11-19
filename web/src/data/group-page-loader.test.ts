import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isQuizSession } from "../lib/quiz-types";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import {
  GroupPageArtifactError,
  loadGroupQuizSession,
  loadGroupWordSearch,
} from "./group-page-loader";

const PUBLIC = join(__dirname, "..", "..", "public");
const SKZ = join(PUBLIC, "data", "group-pages", "stray-kids");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("group page artifacts", () => {
  it("ships a 10-question Stray Kids session in both locales", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const payload = JSON.parse(readFileSync(join(SKZ, `session.${locale}.json`), "utf-8"));
      expect(isQuizSession(payload)).toBe(true);
      expect(payload.config.group_id).toBe("Q46134670");
      expect(payload.questions).toHaveLength(10);
    }
  });

  it("ships a word search with at least six current members", () => {
    const payload = JSON.parse(readFileSync(join(SKZ, "word-search.json"), "utf-8"));
    expect(isWordSearchPuzzle(payload)).toBe(true);
    expect(payload.words.length).toBeGreaterThanOrEqual(6);
    expect(payload.words.some((word: { word: string }) => word.word === "HANJISUNG")).toBe(true);
    expect(payload.words.every((word: { word: string }) => word.word !== "IN")).toBe(true);
  });
});

describe("group page loader", () => {
  it("loads the published session for a slug", async () => {
    const body = readFileSync(join(SKZ, "session.pt-BR.json"), "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    const session = await loadGroupQuizSession("stray-kids", "pt-BR", "/");
    expect(session.questions).toHaveLength(10);
    expect(session.config.group_id).toBe("Q46134670");
  });

  it("loads the published word search for a slug", async () => {
    const body = readFileSync(join(SKZ, "word-search.json"), "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    const puzzle = await loadGroupWordSearch("stray-kids", "/");
    expect(puzzle.words.length).toBeGreaterThanOrEqual(6);
  });

  it("reports missing artifacts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(loadGroupWordSearch("stray-kids", "/")).rejects.toBeInstanceOf(GroupPageArtifactError);
  });
});
