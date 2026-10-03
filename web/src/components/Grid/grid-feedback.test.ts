import { describe, expect, it } from "vitest";
import { gridBarState, type GridFeedback } from "./grid-feedback";

describe("gridBarState", () => {
  it("keeps the bar neutral when the game is complete", () => {
    const feedback: GridFeedback = { kind: "right", name: "TWICE", n: 1 };
    expect(gridBarState(true, feedback)).toBe("");
  });

  it("marks a right or wrong guess while playing", () => {
    expect(gridBarState(false, { kind: "right", name: "TWICE", n: 1 })).toBe(" is-correct");
    expect(gridBarState(false, { kind: "wrong", name: "EXO", n: 2 })).toBe(" is-incorrect");
  });

  it("stays neutral with no verdict or a share notice", () => {
    expect(gridBarState(false, null)).toBe("");
    expect(gridBarState(false, { kind: "copied", n: 3 })).toBe("");
    expect(gridBarState(false, { kind: "shareFailed", n: 4 })).toBe("");
  });
});
