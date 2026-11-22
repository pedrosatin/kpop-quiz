import { afterEach, describe, expect, it, vi } from "vitest";
import { StrandsArtifactError, loadStrandsPuzzle, verifyStrandsIdentity } from "./strands-loader";
import { isStrandsPuzzle } from "../lib/strands-types";
import validPuzzle from "../tests/fixtures/strands.daily.json";
import { guardAfterChange, guardRows, withoutEachField, type GuardCase } from "../test/guard-table";

describe("published strands puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant strands puzzle payload", () => {
    expect(isStrandsPuzzle(validPuzzle)).toBe(true);
  });

  it("verifies the published puzzle_id against the content hash", async () => {
    await expect(verifyStrandsIdentity(validPuzzle as never)).resolves.toMatchObject({
      puzzle_id: validPuzzle.puzzle_id,
    });
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadStrandsPuzzle("pt-BR", "/base");
    expect(result.schema_version).toBe("kpop-strands-puzzle-v1");
    expect(result.dimensions.rows).toBe(9);
    expect(result.words.length).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith("/base/data/strands.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadStrandsPuzzle("pt-BR")).rejects.toEqual(
      new StrandsArtifactError("missing"),
    );
  });

  it("falls back to data/next/ when the main file is 404 and next/ is today", async () => {
    const today = validPuzzle.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validPuzzle), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await loadStrandsPuzzle("pt-BR", "/base", today);
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/strands.daily.json");
  });

  it("keeps missing before midnight when next/ is still tomorrow", async () => {
    const tomorrow = structuredClone(validPuzzle);
    tomorrow.reference_date = "2026-10-21";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(tomorrow), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 }),
    ));
    await expect(loadStrandsPuzzle("pt-BR", "/base", "2026-10-20")).rejects.toEqual(
      new StrandsArtifactError("missing"),
    );
  });

  it("rejects offline fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(loadStrandsPuzzle("pt-BR")).rejects.toEqual(
      new StrandsArtifactError("offline"),
    );
  });

  it("rejects an incompatible schema version", async () => {
    const broken = { ...structuredClone(validPuzzle), schema_version: "kpop-strands-puzzle-v0" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(broken))));
    await expect(loadStrandsPuzzle("pt-BR")).rejects.toEqual(
      new StrandsArtifactError("incompatible"),
    );
  });

  it("rejects a tampered puzzle_id after structural checks", async () => {
    const broken = {
      ...structuredClone(validPuzzle),
      puzzle_id: "a".repeat(64),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(broken))));
    await expect(loadStrandsPuzzle("pt-BR")).rejects.toEqual(
      new StrandsArtifactError("invalid"),
    );
  });

  it("rejects extra root fields", () => {
    const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
    invalid.extra = true;
    expect(isStrandsPuzzle(invalid)).toBe(false);
  });
});

const fieldCases: GuardCase[] = [
  ...withoutEachField([
    "schema_version",
    "puzzle_id",
    "dataset_version",
    "reference_date",
    "theme",
    "dimensions",
    "grid",
    "words",
  ]),
  ["another schema", (p) => { p.schema_version = "kpop-strands-puzzle-v2"; }, false],
  ["a short puzzle id", (p) => { p.puzzle_id = "abc"; }, false],
  ["eight rows", (p) => { p.dimensions.rows = 8; p.grid = p.grid.slice(0, 8); }, false],
  ["five words", (p) => { p.words = p.words.slice(0, 5); }, false],
  ["extra word field", (p) => { p.words[1].clue = { "pt-BR": "x", en: "x" }; }, false],
  ["two spangrams", (p) => { p.words[1].is_spangram = true; p.words[1].spangram_kind = "entity"; }, false],
];

describe("isStrandsPuzzle fields", () => {
  it.each(guardRows(fieldCases))("$label → $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(validPuzzle, change, isStrandsPuzzle)).toBe(accepted);
  });
});
