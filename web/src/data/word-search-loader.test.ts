import { afterEach, describe, expect, it, vi } from "vitest";
import { WordSearchArtifactError, loadWordSearchPuzzle } from "./word-search-loader";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import validPuzzle from "../../public/data/word-search.daily.json";

describe("published word search puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant word search puzzle payload", () => {
    expect(isWordSearchPuzzle(validPuzzle)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadWordSearchPuzzle("pt-BR", "/kpop-scraping");
    expect(result.schema_version).toBe("kpop-word-search-puzzle-v1");
    expect(result.dimensions.rows).toBe(12);
    expect(result.dimensions.cols).toBe(12);
    expect(result.words.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledWith("/kpop-scraping/data/word-search.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadWordSearchPuzzle("pt-BR")).rejects.toEqual(
      new WordSearchArtifactError("missing")
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
});
