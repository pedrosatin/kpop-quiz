import { afterEach, describe, expect, it, vi } from "vitest";
import { GridArtifactError, loadIntersectionGrid } from "./grid-loader";
import { isIntersectionGrid } from "../lib/quiz-types";
import validGrid from "../tests/fixtures/grid.daily.json";

describe("published intersection grid loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant intersection grid payload", () => {
    expect(isIntersectionGrid(validGrid)).toBe(true);
  });

  it("loads a validated grid below Astro base path", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(validGrid)));
    vi.stubGlobal("fetch", fetch);

    const result = await loadIntersectionGrid("pt-BR", "/base", validGrid.reference_date);
    expect(result.schema_version).toBe("kpop-intersection-grid-v1");
    expect(result.cells).toHaveLength(9);
    expect(fetch).toHaveBeenCalledWith(`/base/data/grid.daily.json?d=${validGrid.reference_date}`);
  });

  it("keeps a reused grid from an earlier day", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(validGrid), { headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadIntersectionGrid("pt-BR", "/", "2099-01-01");
    expect(result.reference_date).toBe(validGrid.reference_date);
    expect(fetch).toHaveBeenCalledWith("/data/grid.daily.json?d=2099-01-01");
  });

  it("treats the host's HTML fallback as a missing artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } })
    ));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("missing"));
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadIntersectionGrid("pt-BR")).rejects.toEqual(new GridArtifactError("missing"));
  });

  it("falls back to data/next/ when root artifact is 404 and next reference date matches today", async () => {
    const today = validGrid.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validGrid), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadIntersectionGrid("pt-BR", "/base", today);
    expect(result.schema_version).toBe("kpop-intersection-grid-v1");
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith(`/base/data/grid.daily.json?d=${today}`);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/grid.daily.json");
  });

  it("falls back to data/next/ when root artifact returns HTML fallback", async () => {
    const today = validGrid.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validGrid), { headers: { "content-type": "application/json" } })
        : new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadIntersectionGrid("pt-BR", "/base", today);
    expect(result.reference_date).toBe(today);
  });

  it("throws missing when both root artifact and next/ return 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    await expect(loadIntersectionGrid("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new GridArtifactError("missing")
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/grid.daily.json?d=2026-03-30");
    expect(fetch).toHaveBeenCalledWith("/base/data/next/grid.daily.json");
  });

  it("does not prematurely serve future grid from next/ when root artifact is 404", async () => {
    const futureGrid = structuredClone(validGrid);
    futureGrid.reference_date = "2026-03-31";
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(futureGrid), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadIntersectionGrid("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new GridArtifactError("missing")
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/grid.daily.json?d=2026-03-30");
    expect(fetch).toHaveBeenCalledWith("/base/data/next/grid.daily.json");
  });

  it("throws missing when root artifact is 404 and next/ has invalid schema", async () => {
    const invalidGrid = { not: "a valid grid" };
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(invalidGrid), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadIntersectionGrid("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new GridArtifactError("missing")
    );
  });

  it("throws missing when root artifact is 404 and next/ has malformed JSON", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response("{ malformed", { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(loadIntersectionGrid("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new GridArtifactError("missing")
    );
  });

  it("throws missing when root artifact is 404 and next/ fetch throws a network error", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/next/")) {
        throw new Error("Network offline");
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadIntersectionGrid("pt-BR", "/base", "2026-03-30")).rejects.toEqual(
      new GridArtifactError("missing")
    );
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
