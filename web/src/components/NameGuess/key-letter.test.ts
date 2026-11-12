import { describe, expect, it } from "vitest";
import { guessLetterFromKey } from "./key-letter";

describe("guessLetterFromKey", () => {
  it("keeps letters from A to Z in upper case", () => {
    expect(guessLetterFromKey("a")).toBe("A");
    expect(guessLetterFromKey("Z")).toBe("Z");
  });

  it("types the base letter of an accented key", () => {
    expect([..."ÈèÖöéÁãçÑüÂ"].map(guessLetterFromKey)).toEqual([..."EEOOEAACNUA"]);
    // A dead key followed by a letter can arrive as the letter and its mark.
    expect(guessLetterFromKey("é")).toBe("E");
  });

  it("ignores keys with no letter from A to Z", () => {
    for (const key of ["ß", "æ", "ø", "1", " ", "-", "ㅂ", "가", "€"]) {
      expect(guessLetterFromKey(key), key).toBeNull();
    }
  });

  it("ignores named keys, dead keys and ligatures that give more than one letter", () => {
    for (const key of ["Enter", "Backspace", "Shift", "Dead", "Process", "Unidentified", "F1", "ﬁ", ""]) {
      expect(guessLetterFromKey(key), key).toBeNull();
    }
  });
});
