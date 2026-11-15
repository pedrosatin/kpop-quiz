import { describe, expect, it } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import {
  EMPTY_SELECTION,
  guessEndsRound,
  guessRejection,
  hasRoundProgress,
  isRepeatedGuess,
  isRoundFinished,
  isRoundWon,
  isSelectionComplete,
  roundOutcome,
  startingHistory,
  startingSelection,
  withSlot,
} from "./code-groups-state";

const puzzle = fixture as unknown as CodeGroupsPuzzle;
const secret = puzzle.secret as string[];
const unused = puzzle.symbols.map((s) => s.qid).filter((id) => !secret.includes(id));
const rotated = secret.slice(1).concat(secret.slice(0, 1));

const miss = (ids: string[] = rotated): CodeGroupsGuess => ({ ids, exact: 0, misplaced: 4 });
const hit: CodeGroupsGuess = { ids: [...secret], exact: 4, misplaced: 0 };

describe("startingSelection", () => {
  it("resumes a pick with at least one slot set", () => {
    const saved = [secret[0]!, "", "", ""];
    const selection = startingSelection(saved);
    expect(selection).toEqual(saved);
    expect(selection).not.toBe(saved);
  });

  it("opens with empty slots when there is no save or it picked nothing", () => {
    expect(startingSelection(undefined)).toEqual([...EMPTY_SELECTION]);
    expect(startingSelection(["", "", "", ""])).toEqual([...EMPTY_SELECTION]);
  });
});

describe("startingHistory", () => {
  it("scores the saved guesses again against the secret", () => {
    expect(startingHistory(puzzle, [rotated, secret])).toEqual([miss(), hit]);
  });

  it("starts empty without a save", () => {
    expect(startingHistory(puzzle, undefined)).toEqual([]);
  });
});

describe("round state", () => {
  it("is won only when the last guess has four exact groups", () => {
    expect(isRoundWon([])).toBe(false);
    expect(isRoundWon([miss()])).toBe(false);
    expect(isRoundWon([miss(), hit])).toBe(true);
    expect(isRoundWon([hit, miss()])).toBe(false);
  });

  it("finishes with the code or at the attempt limit", () => {
    expect(isRoundFinished(puzzle, [miss()])).toBe(false);
    expect(isRoundFinished(puzzle, [hit])).toBe(true);
    expect(isRoundFinished(puzzle, Array.from({ length: puzzle.max_attempts }, () => miss()))).toBe(true);
    expect(isRoundFinished(puzzle, Array.from({ length: puzzle.max_attempts - 1 }, () => miss()))).toBe(false);
  });

  it("reports the outcome only for a finished round", () => {
    expect(roundOutcome(false, false)).toBeNull();
    expect(roundOutcome(true, false)).toBeNull();
    expect(roundOutcome(true, true)).toBe("win");
    expect(roundOutcome(false, true)).toBe("loss");
  });

  it("has progress to save after a guess or a picked slot", () => {
    expect(hasRoundProgress([], ["", "", "", ""])).toBe(false);
    expect(hasRoundProgress([], ["", "", secret[0]!, ""])).toBe(true);
    expect(hasRoundProgress([miss()], ["", "", "", ""])).toBe(true);
  });
});

describe("selection", () => {
  it("changes one slot without touching the original", () => {
    const before = ["", "", "", ""];
    expect(withSlot(before, 2, secret[0]!)).toEqual(["", "", secret[0]!, ""]);
    expect(before).toEqual(["", "", "", ""]);
  });

  it("is complete with four distinct groups", () => {
    expect(isSelectionComplete(secret)).toBe(true);
    expect(isSelectionComplete([secret[0]!, secret[0]!, secret[1]!, secret[2]!])).toBe(false);
    expect(isSelectionComplete([secret[0]!, "", secret[1]!, secret[2]!])).toBe(false);
  });
});

describe("guessRejection", () => {
  it("refuses an empty slot before a repeated group", () => {
    expect(guessRejection([], [secret[0]!, secret[0]!, "", secret[1]!])).toBe("chooseAll");
  });

  it("refuses a repeated group", () => {
    expect(guessRejection([], [secret[0]!, secret[0]!, secret[1]!, secret[2]!])).toBe("chooseDistinct");
  });

  it("refuses the same guess in the same order, but not the same groups in another order", () => {
    expect(isRepeatedGuess([miss()], rotated)).toBe(true);
    expect(guessRejection([miss()], rotated)).toBe("alreadyGuessed");
    const reordered = [rotated[1]!, rotated[0]!, rotated[2]!, rotated[3]!];
    expect(isRepeatedGuess([miss()], reordered)).toBe(false);
    expect(guessRejection([miss()], reordered)).toBeNull();
  });

  it("accepts a new guess with four distinct groups", () => {
    expect(guessRejection([], [unused[0]!, unused[1]!, secret[0]!, secret[1]!])).toBeNull();
  });
});

describe("guessEndsRound", () => {
  it("ends the round with the code or on the last attempt", () => {
    expect(guessEndsRound(puzzle, hit, 0)).toBe(true);
    expect(guessEndsRound(puzzle, miss(), puzzle.max_attempts - 1)).toBe(true);
    expect(guessEndsRound(puzzle, miss(), puzzle.max_attempts - 2)).toBe(false);
  });
});
