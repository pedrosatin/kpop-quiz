// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import {
  FIXED_REFERENCE_DATE,
  FIXED_REPLACED_GRID_ID,
  fixedCodeGroups,
  fixedConnections,
  fixedGrid,
  fixedNameGuess,
  fixedQuizManifest,
  fixedQuizSession,
  fixedTimeline,
  fixedWordSearch,
  serveFixedCode,
  serveFixedConnections,
  serveFixedCrossword,
  serveFixedDaily,
  serveFixedGrid,
  serveFixedMap,
  serveFixedNameGuess,
  serveFixedQuiz,
  serveFixedTimeline,
  serveFixedWordSearch,
} from "../../e2e/helpers/fixed-daily";
import {
  crosswordDaily,
  FIXED_CROSSWORD_DATE,
  freezeCrosswordClock,
  pilotBoard,
  routeCrosswordDaily,
} from "../../e2e/helpers/crossword-daily";
import { isIntersectionGrid, isConnectionsPuzzle, isNameGuessPuzzle, isQuizSession } from "../lib/quiz-types";
import { isGridPublication } from "../data/grid-publication";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import { isTimelinePuzzle } from "../lib/timeline-types";
import { isCodeGroupsPuzzle, verifyCodeGroupsIdentity } from "../data/code-groups";
import { hasGuardClock } from "../../e2e/helpers/guard-clock";

const fixedDir = join(import.meta.dirname, "../../e2e/fixtures/fixed-data");

describe("frozen E2E daily artifacts", () => {
  it("grid.daily.json passes the real intersection-grid loader guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    expect(isIntersectionGrid(grid)).toBe(true);
    expect(grid.reference_date).toBe(FIXED_REFERENCE_DATE);
  });

  it("connections, name-guess, word-search and timeline pass their loader guards on the fixed day", () => {
    expect(isConnectionsPuzzle(fixedConnections)).toBe(true);
    expect(fixedConnections.reference_date).toBe(FIXED_REFERENCE_DATE);
    expect(isNameGuessPuzzle(fixedNameGuess)).toBe(true);
    expect(fixedNameGuess.reference_date).toBe(FIXED_REFERENCE_DATE);
    expect(isWordSearchPuzzle(fixedWordSearch)).toBe(true);
    // Word-search's first published day is 2026-09-18; share text needs #N.
    expect(fixedWordSearch.reference_date).toBe("2026-09-18");
    expect(isTimelinePuzzle(fixedTimeline)).toBe(true);
    expect(fixedTimeline.reference_date).toBe(FIXED_REFERENCE_DATE);
  });

  it("code-groups.daily.json passes structure and identity on the fixed day", async () => {
    expect(isCodeGroupsPuzzle(fixedCodeGroups)).toBe(true);
    expect(fixedCodeGroups.reference_date).toBe(FIXED_REFERENCE_DATE);
    await expect(verifyCodeGroupsIdentity(fixedCodeGroups)).resolves.toBe(fixedCodeGroups);
  });

  it("quiz manifest and every listed session stay internally consistent", () => {
    expect(fixedQuizManifest.schema_version).toBe("kpop-quiz-web-manifest-v2");
    for (const [key, entry] of Object.entries(fixedQuizManifest.sessions)) {
      const session = fixedQuizSession(key);
      expect(isQuizSession(session)).toBe(true);
      expect(session.session_id).toBe(entry.session_id);
      expect(session.dataset_version).toBe(fixedQuizManifest.dataset_version);
      const raw = readFileSync(join(fixedDir, entry.path));
      expect(entry.path).toBe(`session.${key}.${entry.sha256}.json`);
      expect(raw.length).toBeGreaterThan(0);
    }
  });

  it("a corrected-day publication for that board passes the publication guard", () => {
    const grid = JSON.parse(readFileSync(join(fixedDir, "grid.daily.json"), "utf8"));
    const publication = {
      schema_version: "kpop-grid-publication-v1",
      reference_date: grid.reference_date,
      grid_id: grid.grid_id,
      grid_reference_date: grid.reference_date,
      replaces: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    };
    expect(isGridPublication(publication)).toBe(true);
  });
});

describe("fixed daily route contract", () => {
  function pageHarness() {
    const routes = new Map<string, (route: { fulfill: ReturnType<typeof vi.fn>; request: () => { url: () => string } }) => unknown>();
    const context = {};
    const page = {
      clock: { install: vi.fn(), setFixedTime: vi.fn() },
      context: () => context,
      route: vi.fn(async (pattern: string, handler: (route: { fulfill: ReturnType<typeof vi.fn>; request: () => { url: () => string } }) => unknown) => {
        routes.set(pattern, handler);
      }),
    };
    return { page, routes };
  }


  it("tomorrow serves next/ daily sessions dated the day after the freeze", async () => {
    const { page, routes } = pageHarness();
    const served = await serveFixedQuiz(page as unknown as Page, { tomorrow: true });
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date("2026-09-18T18:00:00.000Z") });
    expect(routes.has("**/data/next/manifest-v2.json*")).toBe(true);
    const fulfill = vi.fn();
    await routes.get("**/data/next/manifest-v2.json*")!({ fulfill, request: () => ({ url: () => "https://example.test/data/next/manifest-v2.json" }) });
    const payload = fulfill.mock.calls[0]![0].json as { sessions: Record<string, { path: string }> };
    const nextDaily = payload.sessions["daily.pt-BR.standard"];
    expect(nextDaily?.path).toMatch(/^session\.daily\.pt-BR\.standard\.[0-9a-f]{64}\.json$/);
    // Current day stays on FIXED_REFERENCE_DATE under data/.
    expect(served.sessions["daily.pt-BR.standard"]).toBeTruthy();
  });

  it("serves a fixed normal Grade day and hides live publication sidecars", async () => {
    const { page, routes } = pageHarness();
    const grid = await serveFixedDaily(page as unknown as Page, "grid");
    expect(grid).toBe(fixedGrid);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date(`${FIXED_REFERENCE_DATE}T18:00:00Z`) });
    const responses = new Map<string, unknown>();
    for (const [pattern, handler] of routes) {
      const fulfill = vi.fn((response) => responses.set(pattern, response));
      await handler({ fulfill, request: () => ({ url: () => `https://example.test/data/${pattern}` }) });
    }
    expect(responses.get("**/data/grid.daily.json*")).toEqual({ json: fixedGrid });
    expect(responses.get("**/data/next/grid.daily.json*")).toEqual({ status: 404, body: "" });
    expect(responses.get("**/data/grid-publication.*")).toEqual({ status: 404, body: "" });
    expect([...routes.keys()].every((path) => path.includes("/data/") && path.includes("grid"))).toBe(true);
  });

  it("serves a valid correction sidecar with a fixed wall clock", async () => {
    const { page, routes } = pageHarness();
    await serveFixedGrid(page as unknown as Page, { guardClock: false, replaces: [FIXED_REPLACED_GRID_ID] });
    expect(page.clock.setFixedTime).toHaveBeenCalledWith(new Date(`${FIXED_REFERENCE_DATE}T18:00:00Z`));
    expect(page.clock.install).not.toHaveBeenCalled();
    const fulfill = vi.fn();
    await routes.get(`**/data/grid-publication.${FIXED_REFERENCE_DATE}.json*`)!({
      fulfill,
      request: () => ({ url: () => "" }),
    });
    const { json } = fulfill.mock.calls[0]![0];
    expect(isGridPublication(json)).toBe(true);
    expect(json.replaces).toEqual([FIXED_REPLACED_GRID_ID]);
  });

  it("rejects a malformed correction sidecar before serving it", async () => {
    const { page } = pageHarness();
    await expect(serveFixedGrid(page as unknown as Page, { replaces: ["invalid"] })).rejects.toThrow("publication failed");
  });

  it("serves connections, name-guess, word-search, timeline and code on the fixed day", async () => {
    const cases = [
      { game: "connections" as const, serve: serveFixedConnections, artifact: fixedConnections, file: "connections.daily.json" },
      { game: "name-guess" as const, serve: serveFixedNameGuess, artifact: fixedNameGuess, file: "name-guess.daily.json" },
      { game: "word-search" as const, serve: serveFixedWordSearch, artifact: fixedWordSearch, file: "word-search.daily.json" },
      { game: "timeline" as const, serve: serveFixedTimeline, artifact: fixedTimeline, file: "timeline.daily.json" },
      { game: "code" as const, serve: serveFixedCode, artifact: fixedCodeGroups, file: "code-groups.daily.json" },
    ];
    for (const item of cases) {
      const { page, routes } = pageHarness();
      const served = await item.serve(page as unknown as Page);
      expect(served).toBe(item.artifact);
      expect(page.clock.install).toHaveBeenCalled();
      const fulfill = vi.fn();
      await routes.get(`**/data/${item.file}*`)!({ fulfill, request: () => ({ url: () => "" }) });
      expect(fulfill).toHaveBeenCalledWith({ json: item.artifact });
      await routes.get(`**/data/next/${item.file}*`)!({ fulfill: vi.fn(), request: () => ({ url: () => "" }) });
      const viaEntry = await serveFixedDaily(page as unknown as Page, item.game);
      expect(viaEntry).toBe(item.artifact);
    }
  });

  it("serves the quiz manifest and a session file from the frozen set", async () => {
    const { page, routes } = pageHarness();
    const manifest = await serveFixedQuiz(page as unknown as Page);
    expect(manifest).toBe(fixedQuizManifest);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date(`${FIXED_REFERENCE_DATE}T18:00:00Z`) });
    const fulfill = vi.fn();
    await routes.get("**/data/manifest-v2.json*")!({ fulfill, request: () => ({ url: () => "" }) });
    expect(fulfill).toHaveBeenCalledWith({ json: fixedQuizManifest });
    const entry = fixedQuizManifest.sessions["daily.pt-BR.standard"]!;
    const sessionFulfill = vi.fn();
    await routes.get("**/data/session.*")!({
      fulfill: sessionFulfill,
      request: () => ({ url: () => `https://example.test/data/${entry.path}` }),
    });
    expect(sessionFulfill.mock.calls[0]![0].status).toBe(200);
    expect(JSON.parse(sessionFulfill.mock.calls[0]![0].body as string).session_id).toBe(entry.session_id);
  });

  it("rejects an unknown game at the serveFixedDaily entry", async () => {
    const { page } = pageHarness();
    await expect(serveFixedDaily(page as unknown as Page, "unknown" as "grid")).rejects.toThrow("not wired");
  });

  it("serves the crossword envelope on its first published day", async () => {
    const { page, routes } = pageHarness();
    const daily = await serveFixedCrossword(page as unknown as Page);
    expect(daily.reference_date).toBe(FIXED_CROSSWORD_DATE);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date(`${FIXED_CROSSWORD_DATE}T18:00:00Z`) });
    const fulfill = vi.fn();
    await routes.get("**/data/crossword.daily.json*")!({ fulfill, request: () => ({ url: () => "" }) });
    expect(fulfill).toHaveBeenCalledWith({ json: daily });
    await routes.get("**/data/next/crossword.daily.json*")!({ fulfill: vi.fn(), request: () => ({ url: () => "" }) });
    const viaEntry = await serveFixedDaily(page as unknown as Page, "crossword");
    expect((viaEntry as { reference_date: string }).reference_date).toBe(FIXED_CROSSWORD_DATE);
  });

  it("freezes the map clock on the fixed day without rewriting data routes", async () => {
    const { page, routes } = pageHarness();
    await serveFixedMap(page as unknown as Page);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date(`${FIXED_REFERENCE_DATE}T18:00:00Z`) });
    expect(routes.size).toBe(0);
    await serveFixedDaily(page as unknown as Page, "map");
    expect(page.clock.install).toHaveBeenCalledTimes(2);
  });
});

describe("crossword fixed-day helper", () => {
  function pageHarness() {
    const routes = new Map<string, (route: { fulfill: ReturnType<typeof vi.fn>; request: () => { url: () => string } }) => unknown>();
    const context = {};
    const page = {
      clock: { install: vi.fn(), setFixedTime: vi.fn() },
      context: () => context,
      goto: vi.fn(),
      route: vi.fn(async (pattern: string, handler: (route: { fulfill: ReturnType<typeof vi.fn>; request: () => { url: () => string } }) => unknown) => {
        routes.set(pattern, handler);
      }),
    };
    return { page, routes, context };
  }

  it("seals the pilot board for FIXED_CROSSWORD_DATE", async () => {
    const daily = await crosswordDaily(pilotBoard);
    expect(daily.reference_date).toBe(FIXED_CROSSWORD_DATE);
    expect(daily).toMatchObject({ schema_version: "crossword-daily-v1", status: "ready" });
  });

  it("routes the sealed day on a Page and installs the guard clock once", async () => {
    const { page, routes } = pageHarness();
    await routeCrosswordDaily(page as unknown as Page);
    expect(hasGuardClock(page as unknown as Page)).toBe(true);
    expect(page.clock.install).toHaveBeenCalledWith({ time: new Date(`${FIXED_CROSSWORD_DATE}T18:00:00Z`) });
    await freezeCrosswordClock(page as unknown as Page);
    expect(page.clock.install).toHaveBeenCalledTimes(1);
    const fulfill = vi.fn();
    await routes.get("**/data/crossword.daily.json")!({ fulfill, request: () => ({ url: () => "" }) });
    expect(fulfill.mock.calls[0]![0].json.reference_date).toBe(FIXED_CROSSWORD_DATE);
    const next = vi.fn();
    await routes.get("**/data/next/crossword.daily.json")!({ fulfill: next, request: () => ({ url: () => "" }) });
    expect(next).toHaveBeenCalledWith({ status: 404, body: "" });
  });

  it("routes on a BrowserContext without touching a page clock", async () => {
    const routes = new Map<string, unknown>();
    const context = {
      route: vi.fn(async (pattern: string, handler: unknown) => {
        routes.set(pattern, handler);
      }),
    };
    await routeCrosswordDaily(context as never);
    expect(routes.has("**/data/crossword.daily.json")).toBe(true);
    expect(routes.has("**/data/next/crossword.daily.json")).toBe(true);
  });

  it("setFixedTime path freezes without the guard clock", async () => {
    const { page } = pageHarness();
    await freezeCrosswordClock(page as unknown as Page, { guardClock: false });
    expect(page.clock.setFixedTime).toHaveBeenCalledWith(new Date(`${FIXED_CROSSWORD_DATE}T18:00:00Z`));
    expect(page.clock.install).not.toHaveBeenCalled();
  });
});
