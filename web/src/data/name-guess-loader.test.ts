import { afterEach, describe, expect, it, vi } from "vitest";
import { NameGuessArtifactError, loadNameGuessPuzzle } from "./name-guess-loader";
import { isNameGuessPuzzle } from "../lib/quiz-types";
import validPuzzle from "../tests/fixtures/name-guess.daily.json";

describe("published name guess puzzle loader and validator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates a compliant name guess puzzle payload", () => {
    expect(isNameGuessPuzzle(validPuzzle)).toBe(true);
  });

  it("loads a validated puzzle below Astro base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPuzzle)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadNameGuessPuzzle("pt-BR", "/base");
    expect(result.schema_version).toBe("kpop-name-guess-puzzle-v1");
    expect(result.word_length).toBe(5);
    expect(result.target.normalized_name).toBe("TWICE");
    expect(fetchMock).toHaveBeenCalledWith("/base/data/name-guess.daily.json");
  });

  it("distinguishes a missing artifact with 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadNameGuessPuzzle("pt-BR")).rejects.toEqual(new NameGuessArtifactError("missing"));
  });

  it("rejects non-ok HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
    await expect(loadNameGuessPuzzle("pt-BR")).rejects.toEqual(new NameGuessArtifactError("invalid"));
  });

  it("rejects malformed JSON at the browser boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(loadNameGuessPuzzle("pt-BR")).rejects.toEqual(new NameGuessArtifactError("invalid"));
  });

  it("rejects invalid schema version", () => {
    const invalid = structuredClone(validPuzzle) as Record<string, unknown>;
    invalid.schema_version = "kpop-name-guess-puzzle-v2";
    expect(isNameGuessPuzzle(invalid)).toBe(false);
  });

  it("rejects word_length mismatch with target normalized_name", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.word_length = 6;
    expect(isNameGuessPuzzle(invalid)).toBe(false);
  });

  it("rejects when target is not in valid_guesses", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.valid_guesses = invalid.valid_guesses.filter((g) => g !== "TWICE");
    expect(isNameGuessPuzzle(invalid)).toBe(false);
  });

  it("rejects when valid_guesses has word of wrong length", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.valid_guesses.push("ITZY"); // length 4 instead of 5
    expect(isNameGuessPuzzle(invalid)).toBe(false);
  });

  it("rejects invalid max_attempts", () => {
    const invalid = structuredClone(validPuzzle);
    invalid.max_attempts = 3;
    expect(isNameGuessPuzzle(invalid)).toBe(false);
  });
});
