import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import publishedJson from "../../../public/data/crossword-pilot.json";
import type { CrosswordPuzzle } from "../../data/crossword";
import { getMessages } from "../../i18n/catalog";
import { barMessage } from "./CrosswordGameContent";
import { lettersFrom, nextSquare, otherWord, squareClass } from "./CrosswordGrid";
import { wrongSquares } from "./crossword-save";
import { withoutSquares } from "./useCrosswordGame";

const puzzle = publishedJson as unknown as CrosswordPuzzle;
const en = getMessages("en");

function text(node: ReturnType<typeof barMessage>["message"]): string {
  if (!node) return "";
  return render(node).container.textContent ?? "";
}

describe("crossword action bar message", () => {
  it("shows the hint, then the wrong-check verdict while playing", () => {
    expect(barMessage("playing", 0, null, en)).toMatchObject({ barState: "" });
    expect(text(barMessage("playing", 0, null, en).message)).toBe(en.crosswordHint);
    const wrong = barMessage("playing", 2, null, en, 3);
    expect(wrong.barState).toBe(" is-incorrect");
    expect(text(wrong.message)).toBe("3 squares to fix.");
  });

  it("tints only a win and announces the share outcome after the end", () => {
    expect(barMessage("won", 0, null, en)).toEqual({ message: null, barState: " is-correct" });
    expect(barMessage("revealed", 3, null, en)).toEqual({ message: null, barState: "" });
    expect(text(barMessage("won", 0, { kind: "copied", n: 1 }, en).message)).toBe(en.copiedToClipboard);
    expect(text(barMessage("revealed", 0, { kind: "shareFailed", n: 2 }, en).message)).toBe(en.shareFailed);
  });
});

describe("crossword grid helpers", () => {
  const word = ["0:0", "0:1", "0:2"];

  it("spreads typed letters over the next squares of the word and clears on delete", () => {
    expect(lettersFrom("é", "0:0", word)).toEqual({ "0:0": "E" });
    expect(lettersFrom("bts!", "0:0", word)).toEqual({ "0:0": "B", "0:1": "T", "0:2": "S" });
    expect(lettersFrom("xyz", "0:2", word)).toEqual({ "0:2": "X" });
    expect(lettersFrom("", "0:1", word)).toEqual({ "0:1": "" });
  });

  it("moves to the next square, skipping blocks, and stops at the edge", () => {
    const inputs: Record<string, HTMLInputElement | null> = {};
    for (const c of puzzle.cells) inputs[`${c.row}:${c.col}`] = document.createElement("input");
    // Row 1 has squares only in columns 0 and 2; column 1 is a block.
    expect(nextSquare(puzzle, inputs, 1, 0, [0, 1])).toBe(inputs["1:2"]);
    expect(nextSquare(puzzle, inputs, 0, 0, [-1, 0])).toBeNull();
    expect(nextSquare(puzzle, inputs, 0, 0, [0, -1])).toBeNull();
    expect(nextSquare(puzzle, inputs, 5, 2, [0, -1])).toBeNull();
  });
});

describe("crossword check marks", () => {
  it("lists the squares that are wrong or empty", () => {
    const values: Record<string, string> = {};
    for (const c of puzzle.cells) values[`${c.row}:${c.col}`] = c.answer;
    expect(wrongSquares(puzzle, values).size).toBe(0);
    values["0:1"] = "X";
    delete values["5:2"];
    expect([...wrongSquares(puzzle, values)].sort()).toEqual(["0:1", "5:2"]);
    expect(wrongSquares(puzzle, {}).size).toBe(puzzle.cells.length);
  });

  it("drops a mark when its square is edited and keeps the same set otherwise", () => {
    const marked = new Set(["0:1", "5:2"]);
    expect(withoutSquares(marked, ["0:0"])).toBe(marked);
    expect([...withoutSquares(marked, ["0:1", "0:2"])]).toEqual(["5:2"]);
  });

  it("says how many squares are marked in both languages", () => {
    const pt = getMessages("pt-BR");
    expect(pt.crosswordWrong(1)).toBe("1 quadrado a corrigir.");
    expect(pt.crosswordWrong(4)).toBe("4 quadrados a corrigir.");
    expect(en.crosswordWrong(1)).toBe("1 square to fix.");
    expect(en.crosswordWrong(4)).toBe("4 squares to fix.");
  });

  it("marks a square only while playing", () => {
    expect(squareClass(false, true, true)).toBe("crossword-cell selected is-wrong");
    expect(squareClass(false, false, true)).toBe("crossword-cell is-wrong");
    expect(squareClass(true, true, true)).toBe("crossword-cell");
  });

  it("finds the other word only at a crossing that holds the selected word", () => {
    const [across, down, sistar] = puzzle.entries as [CrosswordPuzzle["entries"][number], CrosswordPuzzle["entries"][number], CrosswordPuzzle["entries"][number]];
    expect(otherWord([across, down], down)).toBe(across);
    expect(otherWord([across, down], across)).toBe(down);
    expect(otherWord([down], down)).toBeNull();
    expect(otherWord([across, down], sistar)).toBeNull();
  });
});
