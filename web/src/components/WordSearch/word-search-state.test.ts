import { describe, expect, it } from "vitest";
import validPuzzle from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import {
  cellKey,
  foundCellColors,
  hasGivenUp,
  revealedCellKeys,
  roundOutcome,
  selectionPath,
  wordPath,
} from "./word-search-state";

const puzzle = validPuzzle as unknown as WordSearchPuzzle;
const word = (text: string) => puzzle.words.find((w) => w.word === text)!;
const keysOf = (w: WordSearchWord) => wordPath(w).map(cellKey);

describe("wordPath", () => {
  it("runs from the first letter to the last", () => {
    const shindong = word("SHINDONG");
    const path = wordPath(shindong);
    expect(path).toHaveLength(shindong.word.length);
    expect(path[0]).toEqual({ row: shindong.start_row, col: shindong.start_col });
    expect(path.at(-1)).toEqual({ row: shindong.end_row, col: shindong.end_col });
    expect(path.map((c) => puzzle.grid[c.row]![c.col]).join("")).toBe("SHINDONG");
  });
});

describe("hasGivenUp and roundOutcome", () => {
  it("reads a finished round with words left as a give-up", () => {
    expect(hasGivenUp("completed", 2, 5)).toBe(true);
    expect(hasGivenUp("completed", 5, 5)).toBe(false);
    expect(hasGivenUp("in_progress", 2, 5)).toBe(false);
  });

  it("has no outcome while playing, and a win or a give-up at the end", () => {
    expect(roundOutcome("in_progress", 5, 5)).toBeNull();
    expect(roundOutcome("completed", 5, 5)).toBe("win");
    expect(roundOutcome("completed", 0, 5)).toBe("give_up");
  });
});

describe("foundCellColors", () => {
  it("colors only the found words, by their place in the list", () => {
    const found = [word("SHINDONG").id, word("LEESUNGMIN").id];
    const colors = foundCellColors(puzzle.words, found);
    const shindongIndex = puzzle.words.indexOf(word("SHINDONG"));
    for (const key of keysOf(word("SHINDONG"))) expect(colors.get(key)).toBe(shindongIndex % 6);
    for (const key of keysOf(word("EUNHYUK"))) {
      if (!keysOf(word("SHINDONG")).includes(key) && !keysOf(word("LEESUNGMIN")).includes(key)) expect(colors.has(key)).toBe(false);
    }
  });

  it("gives a shared cell the color of the later word", () => {
    const first = { ...word("SHINDONG"), id: "Q1" };
    const second = { ...word("SHINDONG"), id: "Q2" };
    const colors = foundCellColors([first, second], ["Q1", "Q2"]);
    expect(new Set(colors.values())).toEqual(new Set([1]));
  });

  it("wraps after six colors", () => {
    const words = Array.from({ length: 7 }, (_, i) => ({ ...word("SHINDONG"), id: `Q${i + 1}`, start_col: i, end_col: i }));
    const colors = foundCellColors(words, ["Q7"]);
    expect(colors.get(cellKey({ row: 0, col: 6 }))).toBe(0);
  });
});

describe("revealedCellKeys", () => {
  it("marks the cells of the missing words after a give-up", () => {
    const found = [word("SHINDONG").id];
    const revealed = revealedCellKeys("completed", puzzle.words, found);
    const missing = puzzle.words.filter((w) => w.id !== word("SHINDONG").id).flatMap(keysOf);
    expect(revealed).toEqual(new Set(missing));
  });

  it("marks nothing while playing or after a win", () => {
    expect(revealedCellKeys("in_progress", puzzle.words, []).size).toBe(0);
    expect(revealedCellKeys("completed", puzzle.words, puzzle.words.map((w) => w.id)).size).toBe(0);
  });
});

describe("selectionPath", () => {
  const anchor = { row: 0, col: 0 };

  it("is empty without a start", () => {
    expect(selectionPath(null, { row: 0, col: 3 }, { row: 0, col: 3 })).toEqual([]);
  });

  it("runs to the hovered cell, or to the focused one without a hover", () => {
    expect(selectionPath(anchor, { row: 0, col: 2 }, { row: 2, col: 2 }).map(cellKey)).toEqual(["0,0", "0,1", "0,2"]);
    expect(selectionPath(anchor, null, { row: 2, col: 2 }).map(cellKey)).toEqual(["0,0", "1,1", "2,2"]);
  });

  it("is empty off the start's lines", () => {
    expect(selectionPath(anchor, { row: 1, col: 2 }, anchor)).toEqual([]);
  });
});
