import { describe, expect, it } from "vitest";
import validPuzzle from "../../tests/fixtures/strands.daily.json";
import type { StrandsPuzzle } from "../../lib/strands-types";
import { strandsWordKey } from "../../lib/strands-types";
import {
  areNeighbors,
  extendTrail,
  judgeTrail,
  pathFromCells,
  pathLetters,
  samePath,
} from "./trail";

const puzzle = validPuzzle as unknown as StrandsPuzzle;

describe("strands trail helpers", () => {
  it("treats the eight neighbours as adjacent, including diagonals", () => {
    expect(areNeighbors({ row: 1, col: 1 }, { row: 0, col: 0 })).toBe(true);
    expect(areNeighbors({ row: 1, col: 1 }, { row: 1, col: 3 })).toBe(false);
    expect(areNeighbors({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe(false);
  });

  it("extends into a free neighbour and undoes by revisiting the previous cell", () => {
    const start = [{ row: 4, col: 0 }];
    const mid = extendTrail(start, { row: 4, col: 1 });
    expect(mid).toEqual([
      { row: 4, col: 0 },
      { row: 4, col: 1 },
    ]);
    expect(extendTrail(mid, { row: 4, col: 0 })).toEqual([{ row: 4, col: 0 }]);
  });

  it("refuses to reuse a cell already on the trail", () => {
    const path = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ];
    expect(extendTrail(path, { row: 0, col: 0 })).toEqual(path);
  });

  it("ignores a jump that is not a neighbour", () => {
    const path = [{ row: 0, col: 0 }];
    expect(extendTrail(path, { row: 0, col: 2 })).toEqual(path);
  });

  it("accepts the published spangram path and rejects a miss", () => {
    const spangram = puzzle.words.find((word) => word.is_spangram)!;
    const path = pathFromCells(spangram.cells);
    expect(pathLetters(puzzle.grid, path)).toBe(spangram.word);
    expect(judgeTrail(puzzle, [], path)).toEqual({
      kind: "found",
      wordKey: strandsWordKey(spangram),
      isSpangram: true,
    });
    expect(judgeTrail(puzzle, [strandsWordKey(spangram)], path)).toEqual({
      kind: "repeat",
      wordKey: strandsWordKey(spangram),
      isSpangram: true,
    });
    expect(judgeTrail(puzzle, [], path.slice(0, 2))).toEqual({ kind: "too-short" });
    expect(judgeTrail(puzzle, [], [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }])).toMatchObject({
      kind: "miss",
    });
  });

  it("matches solution paths cell by cell", () => {
    const word = puzzle.words.find((entry) => entry.word === "ALPHAMOONLIT")!;
    const path = pathFromCells(word.cells);
    expect(samePath(path, pathFromCells(word.cells))).toBe(true);
    expect(judgeTrail(puzzle, [], path)).toEqual({
      kind: "found",
      wordKey: strandsWordKey(word),
      isSpangram: false,
    });
  });
});
