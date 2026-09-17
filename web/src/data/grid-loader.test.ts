import { afterEach, describe, expect, it, vi } from "vitest";
import { GridArtifactError, loadIntersectionGrid } from "./grid-loader";
import { isIntersectionGrid } from "../lib/quiz-types";
import validGrid from "../../public/data/grid.daily.json";

describe("published intersection grid loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant intersection grid payload", () => {
    expect(isIntersectionGrid(validGrid)).toBe(true);
  });

  it("loads a validated grid below Astro base path", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(validGrid)));
    vi.stubGlobal("fetch", fetch);

    const result = await loadIntersectionGrid("pt-BR", "/kpop-scraping");
    expect(result.schema_version).toBe("kpop-intersection-grid-v1");
    expect(result.cells).toHaveLength(9);
    expect(fetch).toHaveBeenCalledWith("/kpop-scraping/data/grid.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("missing"));
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("invalid"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("invalid"));
  });

  it("rejects a grid with invalid schema version", () => {
    const invalid = structuredClone(validGrid) as Record<string, unknown>;
    invalid.schema_version = "kpop-intersection-grid-v2";
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects a grid with missing cells", () => {
    const invalid = structuredClone(validGrid);
    invalid.cells = invalid.cells.slice(0, 8);
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects a grid with duplicate cell coordinates", () => {
    const invalid = structuredClone(validGrid);
    invalid.cells[1]!.row_index = 0;
    invalid.cells[1]!.col_index = 0;
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects a grid with invalid candidate QID", () => {
    const invalid = structuredClone(validGrid);
    invalid.candidate_pool[0]!.id = "invalid-qid";
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects a grid when a cell references a QID not in candidate pool", () => {
    const invalid = structuredClone(validGrid);
    invalid.cells[0]!.valid_entity_ids = ["Q999999999"];
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects an invalid reference date", () => {
    const invalid = structuredClone(validGrid);
    invalid.reference_date = "2026-02-30";
    expect(isIntersectionGrid(invalid)).toBe(false);
  });

  it("rejects when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network offline")));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("invalid"));
  });
});
