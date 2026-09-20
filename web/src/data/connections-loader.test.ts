import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionsArtifactError, loadConnectionsPuzzle } from "./connections-loader";
import { isConnectionsPuzzle } from "../lib/quiz-types";
import validPuzzle from "../tests/fixtures/connections.daily.json";

describe("published connections puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant connections puzzle payload", () => {
    expect(isConnectionsPuzzle(validPuzzle)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadConnectionsPuzzle("pt-BR", "/kpop-scraping");
    expect(result.schema_version).toBe("kpop-connections-puzzle-v1");
    expect(result.categories).toHaveLength(4);
    expect(result.items).toHaveLength(16);
    expect(fetchMock).toHaveBeenCalledWith("/kpop-scraping/data/connections.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadConnectionsPuzzle("pt-BR")).rejects.toEqual(new ConnectionsArtifactError("missing"));
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadConnectionsPuzzle("pt-BR")).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadConnectionsPuzzle("pt-BR")).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });

  it("rejects invalid schema version", () => {
    const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
    invalid.schema_version = "kpop-connections-puzzle-v2";
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when categories length is not 4", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.categories = invalid.categories.slice(0, 3);
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when duplicate difficulty level exists", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.categories[1]!.difficulty_level = 1;
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when categories share items", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.categories[1]!.item_ids[0] = invalid.categories[0]!.item_ids[0]!;
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when items count is not 16", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.items = invalid.items.slice(0, 15);
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when an item is not referenced by any category", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.items[0]!.id = "Q99999999";
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects an invalid reference date", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.reference_date = "2026-02-30";
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network offline")));
    await expect(loadConnectionsPuzzle("pt-BR")).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });
});
