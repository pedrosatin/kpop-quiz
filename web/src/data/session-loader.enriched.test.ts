import { afterEach, describe, expect, it, vi } from "vitest";
import { loadQuizSession, loadQuizSessionWithAvailability, QuizArtifactError } from "./session-loader";
import type { QuizSession } from "../lib/quiz-types";
import ptSession from "../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
import manifest from "../tests/fixtures/manifest-v2.json";

/**
 * The enriched manifest lists the same sessions with the decade clues that cite
 * another fact of the answer. A client released before those clues rejects such
 * a session, so it never reads this manifest; this client does, and must leave
 * it for manifest-v2.json whenever it cannot use it.
 */

const RELATED_FACT = "Q9$answer-date";

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The fixture session with a clue on its first question that cites a fact outside the question. */
function enrichedSession(): QuizSession {
  const session = structuredClone(ptSession) as unknown as QuizSession;
  const question = session.questions[0]!;
  question.clues_available = [{
    id: "b".repeat(64),
    type: "decade",
    text: "O fato relacionado está na década de 2020.",
    fact_base_ids: [RELATED_FACT],
    evidence: [{
      fact_base_id: RELATED_FACT,
      locator: "wikipedia:en:pageid=1:revid=2#extract[1:5]",
      revision_id: 2,
      source_key: "wikipedia:en",
      source_url: "https://en.wikipedia.org/w/index.php?curid=1&oldid=2",
    }],
  }];
  return session;
}

async function enrichedWorld(mutate?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>) {
  const session = enrichedSession();
  const sound = new TextEncoder().encode(`${JSON.stringify(session)}\n`);
  const sha256 = await digest(sound);
  const key = "pt-BR.standard";
  const enrichedManifest = structuredClone(manifest) as Record<string, any>;
  enrichedManifest.schema_version = "kpop-quiz-web-manifest-v3";
  const path = `session.${key}.${sha256}.json`;
  enrichedManifest.sessions[key] = { path, sha256, session_id: session.session_id };
  const legacyPath = (manifest.sessions as Record<string, { path: string }>)[key]!.path;
  return {
    enrichedManifest,
    path,
    legacyPath,
    bytes: mutate ? mutate(sound) : sound,
  };
}

function routeFetch(routes: Record<string, Response | (() => Response)>) {
  return vi.fn(async (url: string) => {
    const route = routes[url];
    if (route === undefined) return new Response(null, { status: 404 });
    return typeof route === "function" ? route() : route.clone();
  });
}

const legacyRoutes = (legacyPath: string) => ({
  "/data/manifest-v2.json": new Response(JSON.stringify(manifest)),
  [`/data/${legacyPath}`]: new Response(`${JSON.stringify(ptSession)}\n`),
});

describe("enriched session manifest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves the enriched session without reading the legacy manifest", async () => {
    const world = await enrichedWorld();
    const fetch = routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      [`/data/${world.path}`]: new Response(world.bytes),
      ...legacyRoutes(world.legacyPath),
    });
    vi.stubGlobal("fetch", fetch);
    const session = await loadQuizSession("pt-BR", "standard");
    expect(session.questions[0]!.clues_available[0]!.fact_base_ids).toEqual([RELATED_FACT]);
    expect(session.questions[0]!.fact_base_ids).not.toContain(RELATED_FACT);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/data/manifest-v3.json",
      `/data/${world.path}`,
    ]);
  });

  it("keeps the identity a player's saved games key on", async () => {
    const world = await enrichedWorld();
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      [`/data/${world.path}`]: new Response(world.bytes),
    }));
    const enriched = await loadQuizSession("pt-BR", "standard");
    expect(enriched.session_id).toBe(ptSession.session_id);
    expect(enriched.questions.map(({ id }) => id)).toEqual(ptSession.questions.map(({ id }) => id));
  });

  it("falls back to the legacy session when the enriched manifest is absent", async () => {
    const world = await enrichedWorld();
    const fetch = routeFetch(legacyRoutes(world.legacyPath));
    vi.stubGlobal("fetch", fetch);
    const session = await loadQuizSession("pt-BR", "standard");
    expect(session.questions[0]!.clues_available).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/data/manifest-v3.json",
      "/data/manifest-v2.json",
      `/data/${world.legacyPath}`,
    ]);
  });

  it.each([
    ["answers with a server error", () => new Response(null, { status: 503 })],
    ["is not JSON", () => new Response("<html>")],
    ["has another schema", () => new Response(JSON.stringify({ ...manifest }))],
    ["fails to load", () => { throw new TypeError("network"); }],
  ])("falls back to the legacy session when the enriched manifest %s", async (_label, respond) => {
    const world = await enrichedWorld();
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": respond,
      ...legacyRoutes(world.legacyPath),
    }));
    const session = await loadQuizSession("pt-BR", "standard");
    expect(session.questions[0]!.clues_available).toEqual([]);
  });

  it("falls back when the enriched session is gone, as when a deploy swaps it out", async () => {
    const world = await enrichedWorld();
    const fetch = routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      ...legacyRoutes(world.legacyPath),
    });
    vi.stubGlobal("fetch", fetch);
    const session = await loadQuizSession("pt-BR", "standard");
    expect(session.questions[0]!.clues_available).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(`/data/${world.path}`);
  });

  it("falls back when the enriched session does not match its hash", async () => {
    const world = await enrichedWorld((bytes) => new TextEncoder().encode(`${new TextDecoder().decode(bytes)} `));
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      [`/data/${world.path}`]: new Response(world.bytes),
      ...legacyRoutes(world.legacyPath),
    }));
    const session = await loadQuizSession("pt-BR", "standard");
    expect(session.questions[0]!.clues_available).toEqual([]);
  });

  it("falls back when the enriched session carries a clue without evidence", async () => {
    const session = enrichedSession();
    session.questions[0]!.clues_available[0]!.evidence = [];
    const bytes = new TextEncoder().encode(`${JSON.stringify(session)}\n`);
    const world = await enrichedWorld();
    const sha256 = await digest(bytes);
    world.enrichedManifest.sessions["pt-BR.standard"] = {
      path: `session.pt-BR.standard.${sha256}.json`, sha256, session_id: session.session_id,
    };
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      [`/data/${world.enrichedManifest.sessions["pt-BR.standard"].path}`]: new Response(bytes),
      ...legacyRoutes(world.legacyPath),
    }));
    const loaded = await loadQuizSession("pt-BR", "standard");
    expect(loaded.questions[0]!.clues_available).toEqual([]);
  });

  it("reports the legacy manifest's error when neither can be used", async () => {
    const world = await enrichedWorld();
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      "/data/manifest-v2.json": new Response(null, { status: 404 }),
    }));
    await expect(loadQuizSession("pt-BR", "standard")).rejects.toEqual(new QuizArtifactError("missing"));
  });

  it("offers the decades of the manifest it reads", async () => {
    const world = await enrichedWorld();
    vi.stubGlobal("fetch", routeFetch({
      "/data/manifest-v3.json": new Response(JSON.stringify(world.enrichedManifest)),
      [`/data/${world.path}`]: new Response(world.bytes),
    }));
    await expect(loadQuizSessionWithAvailability("pt-BR", "standard")).resolves.toMatchObject({
      availableDecades: [],
      decades: [],
    });
  });
});
