import { afterEach, describe, expect, it, vi } from "vitest";
import { loadQuizSession, QuizArtifactError } from "./session-loader";
import ptSession from "../../public/data/session.pt-BR.json";
import manifest from "../../public/data/manifest.json";

describe("published session loader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a validated session below Astro's base path", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(ptSession)}\n`));
    vi.stubGlobal("fetch", fetch);
    await expect(loadQuizSession("pt-BR", "/kpop-scraping")).resolves.toMatchObject({ config: { language: "pt-BR" } });
    expect(fetch).toHaveBeenNthCalledWith(1, "/kpop-scraping/data/manifest.json");
    expect(fetch).toHaveBeenNthCalledWith(2, "/kpop-scraping/data/session.pt-BR.json");
  });

  it("distinguishes a missing artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadQuizSession("en")).rejects.toEqual(new QuizArtifactError("missing"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadQuizSession("en")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a session that does not match the manifest", async () => {
    const changed = structuredClone(ptSession);
    changed.dataset_version = "0".repeat(64);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(JSON.stringify(changed))));
    await expect(loadQuizSession("pt-BR")).rejects.toEqual(new QuizArtifactError("invalid"));
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
    changedManifest.sessions["pt-BR"].sha256 = sha256;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(changedManifest)))
      .mockResolvedValueOnce(new Response(bytes)));
    await expect(loadQuizSession("pt-BR")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a manifest path that attempts directory traversal", async () => {
    const changedManifest = structuredClone(manifest) as Record<string, any>;
    changedManifest.sessions.en.path = "../session.en.json";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(changedManifest))));
    await expect(loadQuizSession("en")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects a session whose bytes do not match the declared SHA-256", async () => {
    const changed = structuredClone(ptSession);
    changed.questions[0]!.prompt = "Altered after publication";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
      .mockResolvedValueOnce(new Response(`${JSON.stringify(changed)}\n`)));
    await expect(loadQuizSession("pt-BR")).rejects.toEqual(new QuizArtifactError("invalid"));
  });

  it("rejects evidence that does not identify its fact", async () => {
    const changed = structuredClone(ptSession) as Record<string, any>;
    delete changed.questions[0].evidence[0].fact_base_id;
    const bytes = new TextEncoder().encode(`${JSON.stringify(changed)}\n`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const changedManifest = structuredClone(manifest);
    changedManifest.sessions["pt-BR"].sha256 = sha256;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(changedManifest)))
      .mockResolvedValueOnce(new Response(bytes)));
    await expect(loadQuizSession("pt-BR")).rejects.toEqual(new QuizArtifactError("invalid"));
  });
});
