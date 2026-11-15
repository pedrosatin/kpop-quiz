import { describe, expect, it } from "vitest";
import fixture from "../../../public/data/code-groups.pilot.json";
import type { CodeGroupsGuess, CodeGroupsPuzzle } from "../../data/code-groups";
import { getMessages } from "../../i18n/catalog";
import { feedbackMessage, groupNamesByQid, sharePegs } from "./code-groups-text";

const puzzle = fixture as unknown as CodeGroupsPuzzle;
const pt = getMessages("pt-BR");
const en = getMessages("en");

describe("groupNamesByQid", () => {
  it("names every symbol by its QID", () => {
    const names = groupNamesByQid(puzzle);
    expect([...names.keys()]).toEqual(puzzle.symbols.map((s) => s.qid));
    for (const symbol of puzzle.symbols) expect(names.get(symbol.qid)).toBeTruthy();
  });

  it("drops a trailing note unless two names would then read the same", () => {
    const [a, b, c] = puzzle.symbols as [CodeGroupsPuzzle["symbols"][number], CodeGroupsPuzzle["symbols"][number], CodeGroupsPuzzle["symbols"][number]];
    const names = groupNamesByQid({
      ...puzzle,
      symbols: [{ ...a, name: "Blue (band)" }, { ...b, name: "Blue (group)" }, { ...c, name: "Red (band)" }],
    });
    expect([...names.values()]).toEqual(["Blue (band)", "Blue (group)", "Red"]);
  });
});

describe("sharePegs", () => {
  it("puts exact before misplaced and fills the rest with misses", () => {
    expect(sharePegs({ exact: 1, misplaced: 2 })).toBe("🟩🟨🟨⬜");
    expect(sharePegs({ exact: 0, misplaced: 0 })).toBe("⬜⬜⬜⬜");
    expect(sharePegs({ exact: 4, misplaced: 0 })).toBe("🟩🟩🟩🟩");
  });
});

describe("feedbackMessage", () => {
  const first: CodeGroupsGuess = { ids: [...puzzle.secret].reverse(), exact: 0, misplaced: 4 };
  const second: CodeGroupsGuess = { ids: [...puzzle.secret], exact: 4, misplaced: 0 };

  it("is empty without feedback or without the attempt", () => {
    expect(feedbackMessage(null, [], 10, pt)).toBe("");
    expect(feedbackMessage({ kind: "attempt" }, [], 10, pt)).toBe("");
  });

  it("names each rejection in the player's language", () => {
    expect(feedbackMessage({ kind: "chooseAll" }, [], 10, pt)).toBe(pt.codeChooseAll);
    expect(feedbackMessage({ kind: "chooseDistinct" }, [], 10, en)).toBe(en.codeChooseDistinct);
    expect(feedbackMessage({ kind: "alreadyGuessed" }, [first], 9, pt)).toBe(pt.codeAlreadyGuessed);
  });

  it("numbers the attempt by its place in the history", () => {
    expect(feedbackMessage({ kind: "attempt", attempt: second }, [first, second], 8, en))
      .toBe(en.codeAttemptFeedback(2, 4, 0, 8));
  });
});
