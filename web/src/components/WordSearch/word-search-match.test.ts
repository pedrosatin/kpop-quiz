import { describe, expect, it } from "vitest";
import validPuzzle from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { acceptedNames, isWordMatch, normalizeWord, occurrences } from "./word-search-match";
import { getLinearPath } from "./utils";

const puzzle = validPuzzle as unknown as WordSearchPuzzle;
const word = (text: string) => puzzle.words.find((w) => w.word === text)!;

function read(start: { row: number; col: number }, end: { row: number; col: number }) {
  const letters = getLinearPath(start, end).map((c) => puzzle.grid[c.row]![c.col]!).join("");
  return { letters, revLetters: letters.split("").reverse().join("") };
}

function matches(target: WordSearchWord, start: { row: number; col: number }, end: { row: number; col: number }) {
  const { letters, revLetters } = read(start, end);
  return isWordMatch(target, start, end, letters, revLetters, "pt-BR");
}

describe("normalizeWord", () => {
  it("keeps the letters only, without accents, in upper case", () => {
    expect(normalizeWord("Kim Hee-chul")).toBe("KIMHEECHUL");
    expect(normalizeWord("Ñandú 2")).toBe("NANDU");
  });
});

describe("acceptedNames", () => {
  it("adds each name whole, by its last token and by what follows its first token", () => {
    expect(acceptedNames(word("KIMHEECHUL"), "pt-BR")).toEqual(["KIMHEECHUL", "CHUL", "HEECHUL"]);
    expect(acceptedNames(word("LEESUNGMIN"), "en")).toEqual(["LEESUNGMIN", "SUNGMIN"]);
  });

  it("drops names shorter than three letters or longer than the word on the grid", () => {
    const short = { ...word("LEETEUK"), canonical_name: "Leeteuk Superstar", labels: { "pt-BR": "E U", en: "Leeteuk" } };
    expect(acceptedNames(short, "pt-BR")).toEqual(["LEETEUK"]);
  });
});

describe("occurrences", () => {
  it("finds every start, overlapping ones too", () => {
    expect(occurrences("ABABA", "ABA")).toEqual([0, 2]);
    expect(occurrences("ABC", "X")).toEqual([]);
  });
});

describe("isWordMatch", () => {
  it("finds the whole word in both directions", () => {
    const target = word("SHINDONG");
    const start = { row: target.start_row, col: target.start_col };
    const end = { row: target.end_row, col: target.end_col };
    expect(matches(target, start, end)).toBe(true);
    expect(matches(target, end, start)).toBe(true);
  });

  it("finds an accepted name inside the word, in both directions", () => {
    const target = word("LEESUNGMIN");
    expect(matches(target, { row: 3, col: 0 }, { row: 9, col: 0 })).toBe(true);
    expect(matches(target, { row: 9, col: 0 }, { row: 3, col: 0 })).toBe(true);
  });

  it("refuses a piece that is no accepted name, and a selection past the word", () => {
    const target = word("LEESUNGMIN");
    expect(matches(target, { row: 0, col: 0 }, { row: 3, col: 0 })).toBe(false);
    expect(matches(target, { row: 0, col: 0 }, { row: 10, col: 0 })).toBe(false);
  });

  it("needs the letters to read the name, not only the right cells", () => {
    const target = word("SHINDONG");
    const start = { row: target.start_row, col: target.start_col };
    const end = { row: target.end_row, col: target.end_col };
    expect(isWordMatch(target, start, end, "XXXXXXXX", "XXXXXXXX", "pt-BR")).toBe(false);
  });
});
