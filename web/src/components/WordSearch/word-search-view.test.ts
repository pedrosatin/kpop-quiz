import { describe, expect, it } from "vitest";
import validPuzzle from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { actionBarTone } from "./WordSearchBarMessage";
import { cluesAreIdentical } from "./WordSearchList";

const puzzle = validPuzzle as unknown as WordSearchPuzzle;

describe("actionBarTone", () => {
  const found = { kind: "found", wordId: "Q1", n: 1 } as const;
  const miss = { kind: "miss", letters: "AB", n: 2 } as const;

  it("is green once the round is over, whatever the last verdict", () => {
    expect(actionBarTone(true, miss, true)).toBe(" is-correct");
    expect(actionBarTone(true, null, false)).toBe(" is-correct");
  });

  it("stays neutral while a selection is under way", () => {
    expect(actionBarTone(false, found, true)).toBe("");
  });

  it("takes the tone of the last verdict otherwise", () => {
    expect(actionBarTone(false, found, false)).toBe(" is-correct");
    expect(actionBarTone(false, miss, false)).toBe(" is-incorrect");
    expect(actionBarTone(false, { kind: "cancelled", n: 3 }, false)).toBe("");
    expect(actionBarTone(false, null, false)).toBe("");
  });
});

describe("cluesAreIdentical", () => {
  it("is true when every word repeats the same clue in the page's language", () => {
    expect(cluesAreIdentical(puzzle.words, "pt-BR")).toBe(true);
  });

  it("is false when one clue differs, or with a single word", () => {
    const words = puzzle.words.map((w, i) => (i === 0 ? { ...w, clue: { "pt-BR": "Outra", en: "Other" } } : w));
    expect(cluesAreIdentical(words, "pt-BR")).toBe(false);
    expect(cluesAreIdentical(puzzle.words.slice(0, 1), "pt-BR")).toBe(false);
  });

  it("falls back to the English clue when the page's language has none", () => {
    const words = puzzle.words.map((w, i) => ({ ...w, clue: { "pt-BR": "", en: i === 0 ? "Other" : "Same" } }));
    expect(cluesAreIdentical(words, "pt-BR")).toBe(false);
    expect(cluesAreIdentical(words.slice(1), "pt-BR")).toBe(true);
  });
});
