import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { codeGroupsStorageKey, loadCodeGroupsSave, storeCodeGroupsSave } from "./code-groups-save";

const puzzle = fixture as unknown as CodeGroupsPuzzle;
const secret = puzzle.secret as string[];
const unused = puzzle.symbols.map((s) => s.qid).filter((id) => !secret.includes(id));
const key = codeGroupsStorageKey(puzzle.reference_date);
const empty = ["", "", "", ""];

function save(value: unknown) {
  localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
}

function lossHistory(): string[][] {
  return Array.from({ length: puzzle.max_attempts }, (_, n) => [secret[(n + 1) % 4]!, secret[(n + 2) % 4]!, secret[(n + 3) % 4]!, secret[n % 4]!]);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("loadCodeGroupsSave", () => {
  it("returns a copy of a valid save", () => {
    const stored = { puzzle_id: puzzle.puzzle_id, history: [secret.slice().reverse()], selection: [secret[0]!, "", "", ""] };
    save(stored);
    expect(loadCodeGroupsSave(puzzle)).toEqual(stored);
  });

  it("reads back what storeCodeGroupsSave wrote, with the board id first", () => {
    storeCodeGroupsSave(puzzle, { history: [secret], selection: empty });
    expect(localStorage.getItem(key)).toBe(JSON.stringify({ puzzle_id: puzzle.puzzle_id, history: [secret], selection: empty }));
    expect(loadCodeGroupsSave(puzzle)?.history).toEqual([secret]);
  });

  it.each([
    ["broken JSON", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["another board", { puzzle_id: "f".repeat(64), history: [], selection: empty }],
    ["no board id", { history: [], selection: empty }],
    ["history that is not a list", { puzzle_id: puzzle.puzzle_id, history: {}, selection: empty }],
    ["more guesses than the limit", { puzzle_id: puzzle.puzzle_id, history: [...lossHistory(), secret], selection: empty }],
    ["a guess of three groups", { puzzle_id: puzzle.puzzle_id, history: [secret.slice(0, 3)], selection: empty }],
    ["a guess with a repeated group", { puzzle_id: puzzle.puzzle_id, history: [[secret[0], secret[0], secret[1], secret[2]]], selection: empty }],
    ["a guess outside the symbols", { puzzle_id: puzzle.puzzle_id, history: [[...secret.slice(0, 3), "Q999999"]], selection: empty }],
    ["a selection of three slots", { puzzle_id: puzzle.puzzle_id, history: [], selection: ["", "", ""] }],
    ["a selection outside the symbols", { puzzle_id: puzzle.puzzle_id, history: [], selection: ["Q999999", "", "", ""] }],
    ["a pick after the last attempt", { puzzle_id: puzzle.puzzle_id, history: lossHistory(), selection: [unused[0], "", "", ""] }],
  ])("drops %s", (_, value) => {
    save(value);
    expect(loadCodeGroupsSave(puzzle)).toBeNull();
  });

  it("keeps a lost round with empty slots", () => {
    save({ puzzle_id: puzzle.puzzle_id, history: lossHistory(), selection: empty });
    expect(loadCodeGroupsSave(puzzle)?.history).toHaveLength(puzzle.max_attempts);
  });

  it("prunes the saves of other days and keeps other keys", () => {
    localStorage.setItem("kpop-code-2020-01-01", "{}");
    localStorage.setItem("kpop-code-notes", "keep");
    expect(loadCodeGroupsSave(puzzle)).toBeNull();
    expect(localStorage.getItem("kpop-code-2020-01-01")).toBeNull();
    expect(localStorage.getItem("kpop-code-notes")).toBe("keep");
  });
});
