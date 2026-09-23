import { afterEach, describe, expect, it, vi } from "vitest";
import { loadQuizSession, loadQuizSessionWithAvailability, QuizArtifactError } from "./session-loader";
import type { QuizSession } from "../lib/quiz-types";
import ptSession from "../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import manifest from "../tests/fixtures/manifest-v2.json";

describe("published session loader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a validated session below Astro's base path", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(ptSession)}\n`));
    vi.stubGlobal("fetch", fetch);
    await expect(loadQuizSession("pt-BR", "standard", "history", "/base")).resolves.toMatchObject({ config: { language: "pt-BR", play_mode: "standard" } });
    expect(fetch).toHaveBeenNthCalledWith(1, "/base/data/manifest-v2.json");
    expect(fetch).toHaveBeenNthCalledWith(2, `/base/data/${manifest.sessions["pt-BR.standard"].path}`);
  });

  it("distinguishes a missing artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadQuizSession("en", "standard")).rejects.toEqual(new QuizArtifactError("missing"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadQuizSession("en", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a session that does not match the manifest", async () => {
    const changed = structuredClone(ptSession);
    changed.dataset_version = "0".repeat(64);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(JSON.stringify(changed))));
    await expect(loadQuizSession("pt-BR", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it.each([
    ["language", (session: typeof ptSession) => { session.config.language = "en"; }],
    ["dataset", (session: typeof ptSession) => { session.dataset_version = "0".repeat(64); }],
    ["session id", (session: typeof ptSession) => { session.session_id = "0".repeat(64); }],
  ])("rejects a session with a mismatched %s", async (_label, change) => {
    const changed = structuredClone(ptSession);
    change(changed);
    const bytes = new TextEncoder().encode(`${JSON.stringify(changed)}\n`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const changedManifest = structuredClone(manifest);
    changedManifest.sessions["pt-BR.standard"].sha256 = sha256;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(changedManifest)))
      .mockResolvedValueOnce(new Response(bytes)));
    await expect(loadQuizSession("pt-BR", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a manifest path that attempts directory traversal", async () => {
    const changedManifest = structuredClone(manifest) as Record<string, any>;
    changedManifest.sessions["en.standard"].path = `../session.en.standard.${changedManifest.sessions["en.standard"].sha256}.json`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(changedManifest))));
    await expect(loadQuizSession("en", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a session whose bytes do not match the declared SHA-256", async () => {
    const changed = structuredClone(ptSession);
    changed.questions[0]!.prompt = "Altered after publication";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(changed)}\n`)));
    await expect(loadQuizSession("pt-BR", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects evidence that does not identify its fact", async () => {
    const changed = structuredClone(ptSession) as Record<string, any>;
    delete changed.questions[0].evidence[0].fact_base_id;
    const bytes = new TextEncoder().encode(`${JSON.stringify(changed)}\n`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const changedManifest = structuredClone(manifest);
    changedManifest.sessions["pt-BR.standard"].sha256 = sha256;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(changedManifest)))
      .mockResolvedValueOnce(new Response(bytes)));
    await expect(loadQuizSession("pt-BR", "standard")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("loads a daily session when theme is daily", async () => {
    const dailyManifest = structuredClone(manifest) as Record<string, any>;
    dailyManifest.sessions["daily.pt-BR.standard"] = structuredClone(dailyManifest.sessions["pt-BR.standard"]);
    dailyManifest.sessions["daily.pt-BR.standard"].path = `session.daily.pt-BR.standard.${dailyManifest.sessions["pt-BR.standard"].sha256}.json`;
    for (const mode of ["assisted", "expert"]) {
      dailyManifest.sessions[`daily.pt-BR.${mode}`] = {
        path: `session.daily.pt-BR.${mode}.${"0".repeat(64)}.json`,
        sha256: "0".repeat(64),
        session_id: "0".repeat(64),
      };
    }
    for (const mode of ["assisted", "standard", "expert"]) {
      dailyManifest.sessions[`daily.en.${mode}`] = {
        path: `session.daily.en.${mode}.${"0".repeat(64)}.json`,
        sha256: "0".repeat(64),
        session_id: "0".repeat(64),
      };
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dailyManifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(ptSession)}\n`));
    vi.stubGlobal("fetch", fetch);
    await expect(loadQuizSession("pt-BR", "standard", "daily")).resolves.toMatchObject({ config: { language: "pt-BR", play_mode: "standard" } });
    expect(fetch).toHaveBeenNthCalledWith(2, `/data/${dailyManifest.sessions["daily.pt-BR.standard"].path}`);
  });

  it("loads the unfiltered session when the requested decade is absent", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(ptSession)}\n`));
    vi.stubGlobal("fetch", fetch);
    await expect(loadQuizSession("pt-BR", "standard", "history", "/data-root", [2010])).resolves.toMatchObject({
      config: { language: "pt-BR", play_mode: "standard" },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, `/data-root/data/${manifest.sessions["pt-BR.standard"].path}`);
  });

  it("continues combining after an index contains only duplicate questions", async () => {
    const combinedManifest = structuredClone(manifest) as Record<string, any>;
    const artifacts = new Map<string, string>();
    for (const decade of [1990, 2010]) {
      const session = structuredClone(ptSession) as unknown as QuizSession;
      session.config.decade = decade;
      session.session_id = decade.toString().padStart(64, "0");
      session.questions.forEach((question, index) => {
        question.id = `${decade}${index}`.padStart(64, "0");
        question.decades = [decade];
        question.semantic_id = `${decade}${index}`.padStart(64, "0");
      });
      if (decade === 2010) {
        // Both index-1 questions overlap an index-0 question from the other
        // session. Index 2 onward still contains unique questions.
        session.questions[1]!.semantic_id = "19900".padStart(64, "0");
      } else {
        session.questions[1]!.semantic_id = "20100".padStart(64, "0");
      }
      const bytes = `${JSON.stringify(session)}\n`;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes));
      const sha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const key = `decade.${decade}.pt-BR.standard`;
      const path = `session.${key}.${sha}.json`;
      combinedManifest.sessions[key] = { path, sha256: sha, session_id: session.session_id };
      artifacts.set(`/data/${path}`, bytes);
    }
    const fetch = vi.fn(async (input: string) => input.endsWith("manifest-v2.json")
      ? new Response(JSON.stringify(combinedManifest))
      : new Response(artifacts.get(input)));
    vi.stubGlobal("fetch", fetch);

    const first = await loadQuizSessionWithAvailability("pt-BR", "standard", "history", undefined, [2010, 1990, 1990]);
    const second = await loadQuizSessionWithAvailability("pt-BR", "standard", "history", undefined, [1990, 2010]);

    expect(first.decades).toEqual([1990, 2010]);
    expect(first.session.questions).toHaveLength(10);
    expect(new Set(first.session.questions.map(({ id }) => id)).size).toBe(10);
    expect(new Set(first.session.questions.map(({ semantic_id }) => semantic_id)).size).toBe(10);
    expect(first.session.questions.some(({ id }) => id === "19902".padStart(64, "0"))).toBe(true);
    expect(first.session.questions.some(({ id }) => id === "20102".padStart(64, "0"))).toBe(true);
    expect(first.session.session_id).toBe(second.session.session_id);
  });
});
