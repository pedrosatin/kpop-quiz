import { afterEach, describe, expect, it, vi } from "vitest";
import { WordSearchArtifactError, loadWordSearchPuzzle } from "./word-search-loader";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import validPuzzle from "../tests/fixtures/word-search.daily.json";
import { guardAfterChange, guardRows, type GuardCase } from "../test/guard-table";

describe("published word search puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant word search puzzle payload", () => {
    expect(isWordSearchPuzzle(validPuzzle)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadWordSearchPuzzle("pt-BR", "/base");
    expect(result.schema_version).toBe("kpop-word-search-puzzle-v1");
    expect(result.dimensions.rows).toBe(12);
    expect(result.dimensions.cols).toBe(12);
    expect(result.words.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledWith("/base/data/word-search.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadWordSearchPuzzle("pt-BR")).rejects.toEqual(
      new WordSearchArtifactError("missing")
    );
  });

  it("falls back to data/next/ when the main file is 404 and next/ is today", async () => {
    const today = validPuzzle.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validPuzzle), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);
    const result = await loadWordSearchPuzzle("pt-BR", "/base", today);
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/word-search.daily.json");
  });

  it("keeps missing before midnight when next/ is still tomorrow", async () => {
    const tomorrow = structuredClone(validPuzzle);
    tomorrow.reference_date = "2026-09-19";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(tomorrow), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadWordSearchPuzzle("pt-BR", "/base", "2026-09-18")).rejects.toEqual(
      new WordSearchArtifactError("missing"),
    );
  });

  it("keeps missing when next/ is also 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadWordSearchPuzzle("pt-BR", "/base", validPuzzle.reference_date)).rejects.toEqual(
      new WordSearchArtifactError("missing"),
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/next/word-search.daily.json");
  });

  it("keeps missing when next/ has an invalid artifact", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify({ not: "word-search" }), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadWordSearchPuzzle("pt-BR", "/base", validPuzzle.reference_date)).rejects.toEqual(
      new WordSearchArtifactError("missing"),
    );
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadWordSearchPuzzle("pt-BR")).rejects.toEqual(
      new WordSearchArtifactError("invalid")
    );
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadWordSearchPuzzle("pt-BR")).rejects.toEqual(
      new WordSearchArtifactError("invalid")
    );
  });

  it("rejects invalid schema version", () => {
    const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
    invalid.schema_version = "kpop-word-search-puzzle-v2";
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects invalid grid dimensions", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.dimensions.rows = 5; // below 8
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects grid dimension mismatch with actual grid rows", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.grid.pop();
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects words whose letters do not match grid cells", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.words[0]!.word = "ZZZZZZZZ";
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects non-linear word coordinates", () => {
    const invalid = structuredClone(validPuzzle);
    const firstWord = invalid.words[0]!;
    // Non-linear step: dr=1, dc=2
    firstWord.start_row = 0;
    firstWord.start_col = 0;
    firstWord.end_row = 1;
    firstWord.end_col = 2;
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects evidence whose source URL only looks like https", () => {
    for (const url of ["https://", "https://exa mple.com/"]) {
      const invalid = structuredClone(validPuzzle);
      invalid.words[0]!.evidence[0]!.source_url = url;
      expect(isWordSearchPuzzle(invalid), url).toBe(false);
    }
  });

  it("rejects duplicate word IDs", () => {
    const invalid = structuredClone(validPuzzle);
    const duplicated = structuredClone(invalid.words[0]!);
    invalid.words.push(duplicated);
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects when fewer than 3 words are provided", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.words = invalid.words.slice(0, 2);
    expect(isWordSearchPuzzle(invalid)).toBe(false);
  });

  it("rejects words whose labels do not normalize to the word", () => {
    const invalidEn = structuredClone(validPuzzle);
    // E.g. word is EUNHYUK, but label is set to "I.N"
    invalidEn.words[0]!.labels.en = "I.N";
    expect(isWordSearchPuzzle(invalidEn)).toBe(false);

    const invalidPt = structuredClone(validPuzzle);
    invalidPt.words[0]!.labels["pt-BR"] = "I.N";
    expect(isWordSearchPuzzle(invalidPt)).toBe(false);
  });
});

// The fixture's first word runs diagonally from row 11, column 7 to row 5,
// column 1 of a 12 by 12 grid.
const WORD_SEARCH_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (p) => { p.extra = 1; }, true],
  ["no theme description", (p) => { delete p.theme_description; }, true],
  ["a theme description without English", (p) => { delete p.theme_description.en; }, false],
  ["a blank theme", (p) => { p.theme["pt-BR"] = " "; }, false],
  ["a theme with an extra key", (p) => { p.theme.es = "x"; }, true],
  ["another schema", (p) => { p.schema_version = "kpop-word-search-puzzle-v2"; }, false],
  ["a short puzzle id", (p) => { p.puzzle_id = "abc"; }, false],
  ["a numeric dataset version", (p) => { p.dataset_version = 1; }, false],
  ["a reference date that does not exist", (p) => { p.reference_date = "2026-02-30"; }, true],
  ["a reference date with month 13", (p) => { p.reference_date = "2026-13-01"; }, true],
  ["a reference date without padding", (p) => { p.reference_date = "2026-2-3"; }, false],
  ["dimensions with an extra key", (p) => { p.dimensions.extra = 1; }, true],
  ["dimensions that are a list", (p) => { p.dimensions = [12, 12]; }, false],
  ["seven rows", (p) => { p.dimensions.rows = 7; p.grid = p.grid.slice(0, 7); }, false],
  ["rows as text", (p) => { p.dimensions.rows = "12"; }, false],
  ["a grid with one row less", (p) => { p.grid.pop(); }, false],
  ["a grid row with one column less", (p) => { p.grid[0].pop(); }, false],
  ["a lowercase cell", (p) => { p.grid[0][0] = p.grid[0][0].toLowerCase(); }, false],
  ["a cell with two letters", (p) => { p.grid[0][0] = "AB"; }, false],
  ["a grid row that is not a list", (p) => { p.grid[0] = p.grid[0].join(""); }, false],
  ["two words", (p) => { p.words = p.words.slice(0, 2); }, false],
  ["a word with an extra key", (p) => { p.words[0].extra = 1; }, true],
  ["a word whose id is not a QID", (p) => { p.words[0].id = "x"; }, false],
  ["a word in lowercase", (p) => { p.words[0].word = p.words[0].word.toLowerCase(); }, false],
  ["a blank name", (p) => { p.words[0].canonical_name = " "; }, false],
  ["a word without clue", (p) => { delete p.words[0].clue; }, true],
  ["a clue without English", (p) => { delete p.words[0].clue.en; }, false],
  ["a word without evidence", (p) => { p.words[0].evidence = []; }, false],
  ["evidence with an extra key", (p) => { p.words[0].evidence[0].extra = 1; }, true],
  ["evidence revision 0", (p) => { p.words[0].evidence[0].revision_id = 0; }, false],
  ["evidence with an empty source key", (p) => { p.words[0].evidence[0].source_key = ""; }, false],
  ["evidence with an empty fact id", (p) => { p.words[0].evidence[0].fact_base_id = ""; }, false],
  ["a start row equal to the row count", (p) => { p.words[0].start_row = 12; }, false],
  ["a start row of -1", (p) => { p.words[0].start_row = -1; }, false],
  ["a fractional start row", (p) => { p.words[0].start_row = 10.5; }, false],
  ["a start row as text", (p) => { p.words[0].start_row = "11"; }, false],
  ["an end column of -1", (p) => { p.words[0].end_col = -1; }, false],
  ["an end row equal to the row count", (p) => { p.words[0].end_row = 12; }, false],
  ["a start column equal to the column count", (p) => { p.words[0].start_col = 12; }, false],
  ["a word that ends one cell early", (p) => { p.words[0].end_row = 6; p.words[0].end_col = 2; }, false],
  ["a repeated word under another id", (p) => { p.words.push({ ...structuredClone(p.words[0]), id: "Q1" }); }, false],
];

describe("isWordSearchPuzzle fields", () => {
  it.each(guardRows(WORD_SEARCH_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(validPuzzle, change, isWordSearchPuzzle)).toBe(accepted);
  });
});
