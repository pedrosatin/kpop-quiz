import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import publishedJson from "../../../public/data/crossword-pilot.json";
import type { CrosswordPuzzle } from "../../data/crossword";
import { getMessages } from "../../i18n/catalog";
import { barMessage } from "./CrosswordGameContent";
import { lettersFrom, nextSquare } from "./CrosswordGrid";

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
    const wrong = barMessage("playing", 2, null, en);
    expect(wrong.barState).toBe(" is-incorrect");
    expect(text(wrong.message)).toBe(en.crosswordWrong);
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
