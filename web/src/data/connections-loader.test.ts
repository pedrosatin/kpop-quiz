import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionsArtifactError, loadConnectionsPuzzle } from "./connections-loader";
import { isConnectionsPuzzle } from "../lib/quiz-types";
import validPuzzle from "../tests/fixtures/connections.daily.json";
import { guardAfterChange, guardRows, withoutEachField, type GuardCase } from "../test/guard-table";

describe("published connections puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant connections puzzle payload", () => {
    expect(isConnectionsPuzzle(validPuzzle)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadConnectionsPuzzle("/base");
    expect(result.schema_version).toBe("kpop-connections-puzzle-v1");
    expect(result.categories).toHaveLength(4);
    expect(result.items).toHaveLength(16);
    expect(fetchMock).toHaveBeenCalledWith("/base/data/connections.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadConnectionsPuzzle()).rejects.toEqual(new ConnectionsArtifactError("missing"));
  });

  it("falls back to data/next/ when the main file is 404 and next/ is today", async () => {
    const today = validPuzzle.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validPuzzle), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);
    const result = await loadConnectionsPuzzle("/base", today);
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/connections.daily.json");
  });

  it("keeps missing before midnight when next/ is still tomorrow", async () => {
    const tomorrow = structuredClone(validPuzzle);
    tomorrow.reference_date = "2026-09-18";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(tomorrow), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadConnectionsPuzzle("/base", "2026-09-17")).rejects.toEqual(
      new ConnectionsArtifactError("missing"),
    );
  });

  it("keeps missing when next/ is also 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadConnectionsPuzzle("/base", validPuzzle.reference_date)).rejects.toEqual(
      new ConnectionsArtifactError("missing"),
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/next/connections.daily.json");
  });

  it("keeps missing when next/ has an invalid artifact", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify({ not: "connections" }), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadConnectionsPuzzle("/base", validPuzzle.reference_date)).rejects.toEqual(
      new ConnectionsArtifactError("missing"),
    );
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadConnectionsPuzzle()).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadConnectionsPuzzle()).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });

  it("rejects invalid schema version", () => {
    const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
    invalid.schema_version = "kpop-connections-puzzle-v2";
    expect(isConnectionsPuzzle(invalid)).toBe(false);
  });

  it("rejects dimensions other than 4 groups of 4 items", () => {
    for (const dimensions of [{ groups: 4, items_per_group: 4, total_items: 15 }, { groups: 4, items_per_group: 4 }]) {
      const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
      invalid.dimensions = dimensions;
      expect(isConnectionsPuzzle(invalid)).toBe(false);
    }
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
    await expect(loadConnectionsPuzzle()).rejects.toEqual(new ConnectionsArtifactError("invalid"));
  });
});

const CONNECTIONS_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (p) => { p.extra = 1; }, false],
  ...withoutEachField(["schema_version", "puzzle_id", "dataset_version", "reference_date", "dimensions", "categories", "items"]),
  ["a short puzzle id", (p) => { p.puzzle_id = "abc"; }, false],
  ["an uppercase dataset version", (p) => { p.dataset_version = "A".repeat(64); }, false],
  ["a reference date before year 100", (p) => { p.reference_date = "0099-01-01"; }, false],
  ["dimensions with an extra key", (p) => { p.dimensions.extra = 1; }, false],
  ["16 items given as text", (p) => { p.dimensions.total_items = "16"; }, false],
  ["a category with an empty id", (p) => { p.categories[0].id = ""; }, false],
  ["a category with a blank id", (p) => { p.categories[0].id = " "; }, true],
  ["a category label without English", (p) => { delete p.categories[0].label.en; }, false],
  ["a category explanation with an extra key", (p) => { p.categories[0].explanation.es = "x"; }, false],
  ["a category explanation with an empty text", (p) => { p.categories[0].explanation["pt-BR"] = ""; }, false],
  ["difficulty 5", (p) => { p.categories[0].difficulty_level = 5; }, false],
  ["difficulty 0", (p) => { p.categories[0].difficulty_level = 0; }, false],
  ["difficulty as text", (p) => { p.categories[0].difficulty_level = String(p.categories[0].difficulty_level); }, false],
  ["a category with three items", (p) => { p.categories[0].item_ids.pop(); }, false],
  ["a category repeating an item", (p) => { p.categories[0].item_ids[1] = p.categories[0].item_ids[0]; }, false],
  ["a category with an item that is not a QID", (p) => { p.categories[0].item_ids[0] = "Q0"; }, false],
  ["a category without evidence", (p) => { p.categories[0].evidence = []; }, false],
  ["category evidence with an empty locator", (p) => { p.categories[0].evidence[0].locator = ""; }, false],
  ["category evidence revision 0", (p) => { p.categories[0].evidence[0].revision_id = 0; }, false],
  ["a category with an extra key", (p) => { p.categories[0].extra = 1; }, false],
  ["an item whose id is not a QID", (p) => { p.items[0].id = "x"; }, false],
  ["an item with an empty name", (p) => { p.items[0].canonical_name = ""; }, false],
  ["an item without English label", (p) => { delete p.items[0].labels.en; }, false],
  ["an item with an extra key", (p) => { p.items[0].extra = 1; }, false],
  ["a repeated item", (p) => { p.items[1] = structuredClone(p.items[0]); }, false],
];

describe("isConnectionsPuzzle fields", () => {
  it.each(guardRows(CONNECTIONS_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(validPuzzle, change, isConnectionsPuzzle)).toBe(accepted);
  });
});
