import { afterEach, describe, expect, it, vi } from "vitest";
import { NameGuessArtifactError, loadNameGuessPuzzle } from "./name-guess-loader";
import { isNameGuessPuzzle } from "../lib/quiz-types";
import validPuzzle from "../tests/fixtures/name-guess.daily.json";
import { guardAfterChange, guardRows, withoutEachField, type GuardCase } from "../test/guard-table";

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

  it("falls back to data/next/ when the main file is 404 and next/ is today", async () => {
    const today = validPuzzle.reference_date;
    const fetch = vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(validPuzzle), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);
    const result = await loadNameGuessPuzzle("pt-BR", "/base", today);
    expect(result.reference_date).toBe(today);
    expect(fetch).toHaveBeenCalledWith("/base/data/next/name-guess.daily.json");
  });

  it("keeps missing before midnight when next/ is still tomorrow", async () => {
    const tomorrow = structuredClone(validPuzzle);
    tomorrow.reference_date = "2026-09-19";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify(tomorrow), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadNameGuessPuzzle("pt-BR", "/base", "2026-09-18")).rejects.toEqual(
      new NameGuessArtifactError("missing"),
    );
  });

  it("keeps missing when next/ is also 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadNameGuessPuzzle("pt-BR", "/base", validPuzzle.reference_date)).rejects.toEqual(
      new NameGuessArtifactError("missing"),
    );
    expect(fetch).toHaveBeenCalledWith("/base/data/next/name-guess.daily.json");
  });

  it("keeps missing when next/ has an invalid artifact", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/next/")
        ? new Response(JSON.stringify({ not: "name-guess" }), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    ));
    await expect(loadNameGuessPuzzle("pt-BR", "/base", validPuzzle.reference_date)).rejects.toEqual(
      new NameGuessArtifactError("missing"),
    );
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

/** Makes `name` the answer and the only accepted guess, with its length as the word length. */
const answer = (p: any, name: string) => {
  p.word_length = name.length;
  p.target.normalized_name = name;
  p.valid_guesses = [name];
};

const NAME_GUESS_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (p) => { p.extra = 1; }, false],
  ...withoutEachField(["schema_version", "puzzle_id", "dataset_version", "reference_date", "word_length", "max_attempts", "target", "valid_guesses"]),
  ["a short puzzle id", (p) => { p.puzzle_id = "abc"; }, false],
  ["a numeric dataset version", (p) => { p.dataset_version = 1; }, false],
  ["a reference date before year 100", (p) => { p.reference_date = "0099-01-01"; }, false],
  ["a two-letter answer", (p) => { answer(p, "AB"); }, false],
  ["a three-letter answer", (p) => { answer(p, "ABC"); }, true],
  ["a ten-letter answer", (p) => { answer(p, "ABCDEFGHIJ"); }, true],
  ["an eleven-letter answer", (p) => { answer(p, "ABCDEFGHIJK"); }, false],
  ["a fractional word length", (p) => { p.word_length = 5.5; }, false],
  ["a word length as text", (p) => { p.word_length = String(p.word_length); }, false],
  ["three attempts", (p) => { p.max_attempts = 3; }, false],
  ["four attempts", (p) => { p.max_attempts = 4; }, true],
  ["eight attempts", (p) => { p.max_attempts = 8; }, true],
  ["nine attempts", (p) => { p.max_attempts = 9; }, false],
  ["fractional attempts", (p) => { p.max_attempts = 6.5; }, false],
  ["a target whose id is not a QID", (p) => { p.target.id = "x"; }, false],
  ["a target with an empty name", (p) => { p.target.canonical_name = ""; }, false],
  ["a target with a blank name", (p) => { p.target.canonical_name = " "; }, true],
  ["a lowercase answer", (p) => { answer(p, "twice"); }, false],
  ["a target label with an extra key", (p) => { p.target.labels.es = "x"; }, false],
  ["a person as target", (p) => { p.target.entity_type = "person"; }, true],
  ["an organization as target", (p) => { p.target.entity_type = "organization"; }, false],
  ["a target without evidence", (p) => { p.target.evidence = []; }, false],
  ["target evidence revision 0", (p) => { p.target.evidence[0].revision_id = 0; }, false],
  ["target evidence with an extra key", (p) => { p.target.evidence[0].extra = 1; }, false],
  ["a target with an extra key", (p) => { p.target.extra = 1; }, false],
  ["a target without labels", (p) => { delete p.target.labels; }, false],
  ["a target without clues", (p) => { delete p.target.clues; }, true],
  ["empty clues", (p) => { p.target.clues = {}; }, true],
  ["clues that are a list", (p) => { p.target.clues = []; }, false],
  ["clues null", (p) => { p.target.clues = null; }, false],
  ["clues with an extra key", (p) => { p.target.clues.extra = 1; }, false],
  ["debut in 1899", (p) => { p.target.clues.debut_year = 1899; }, false],
  ["debut in 1900", (p) => { p.target.clues.debut_year = 1900; }, true],
  ["debut in 2100", (p) => { p.target.clues.debut_year = 2100; }, true],
  ["debut in 2101", (p) => { p.target.clues.debut_year = 2101; }, false],
  ["a fractional debut year", (p) => { p.target.clues.debut_year = 2015.5; }, false],
  ["a debut year as text", (p) => { p.target.clues.debut_year = "2015"; }, false],
  ["an agency as text", (p) => { p.target.clues.agency = "JYP"; }, true],
  ["an empty agency", (p) => { p.target.clues.agency = ""; }, false],
  ["a blank agency", (p) => { p.target.clues.agency = " "; }, true],
  ["an agency with an empty translation", (p) => { p.target.clues.agency["pt-BR"] = ""; }, false],
  ["a numeric agency", (p) => { p.target.clues.agency = 1; }, false],
  ["no member", (p) => { p.target.clues.members_count = 0; }, false],
  ["one member", (p) => { p.target.clues.members_count = 1; }, true],
  ["fifty members", (p) => { p.target.clues.members_count = 50; }, true],
  ["51 members", (p) => { p.target.clues.members_count = 51; }, false],
  ["a description as text", (p) => { p.target.clues.description = "x"; }, false],
  ["no valid guess", (p) => { p.valid_guesses = []; }, false],
  ["a repeated guess", (p) => { p.valid_guesses.push(p.valid_guesses[0]); }, false],
  ["a numeric guess", (p) => { p.valid_guesses.push(12345); }, false],
  ["a lowercase guess", (p) => { p.valid_guesses.push("abcde"); }, false],
];

describe("isNameGuessPuzzle fields", () => {
  it.each(guardRows(NAME_GUESS_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(validPuzzle, change, isNameGuessPuzzle)).toBe(accepted);
  });
});
