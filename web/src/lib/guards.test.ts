import { describe, expect, it } from "vitest";
import {
  hasDistinctItems,
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isIsoDate,
  isNonBlankString,
  isNonEmptyString,
  isQid,
  isRecord,
  isStringList,
  matchesPattern,
} from "./guards";

const HASH = "0123456789abcdef".repeat(4);

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({})).toBe(true);
  });

  it.each([null, [], "x", 1, undefined])("refuses %j", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe("matchesPattern", () => {
  it("accepts a string the pattern matches", () => {
    expect(matchesPattern("abc", /^a/)).toBe(true);
  });

  it.each(["xbc", 1, null])("refuses %j", (value) => {
    expect(matchesPattern(value, /^a/)).toBe(false);
  });
});

describe("isHash", () => {
  it("accepts 64 lowercase hex digits", () => {
    expect(isHash(HASH)).toBe(true);
  });

  it.each([HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, `${HASH.slice(1)}g`, 1, null])("refuses %j", (value) => {
    expect(isHash(value)).toBe(false);
  });
});

describe("isQid", () => {
  it.each(["Q1", "Q42", "Q123456789"])("accepts %s", (value) => {
    expect(isQid(value)).toBe(true);
  });

  it.each(["Q0", "Q01", "q42", "P42", "Q", 42])("refuses %j", (value) => {
    expect(isQid(value)).toBe(false);
  });
});

describe("isNonEmptyString", () => {
  it.each(["a", " "])("accepts %j, whitespace included", (value) => {
    expect(isNonEmptyString(value)).toBe(true);
  });

  it.each(["", 1, null, ["a"]])("refuses %j", (value) => {
    expect(isNonEmptyString(value)).toBe(false);
  });
});

describe("isNonBlankString", () => {
  it.each(["a", " a "])("accepts %j", (value) => {
    expect(isNonBlankString(value)).toBe(true);
  });

  it.each(["", " ", "\n\t", 1, null])("refuses %j", (value) => {
    expect(isNonBlankString(value)).toBe(false);
  });
});

describe("hasExactKeys", () => {
  it("accepts every required key", () => {
    expect(hasExactKeys({ a: 1, b: 2 }, ["a", "b"])).toBe(true);
  });

  it("accepts an optional key, present or absent", () => {
    expect(hasExactKeys({ a: 1, c: 3 }, ["a"], ["c"])).toBe(true);
    expect(hasExactKeys({ a: 1 }, ["a"], ["c"])).toBe(true);
  });

  it("counts a required key whose value is undefined", () => {
    expect(hasExactKeys({ a: undefined }, ["a"])).toBe(true);
  });

  it("refuses a missing required key", () => {
    expect(hasExactKeys({ a: 1 }, ["a", "b"])).toBe(false);
  });

  it("refuses a key outside both lists", () => {
    expect(hasExactKeys({ a: 1, x: 0 }, ["a"], ["c"])).toBe(false);
  });

  it("accepts only optional keys when none is required", () => {
    expect(hasExactKeys({}, [], ["c"])).toBe(true);
    expect(hasExactKeys({ x: 0 }, [], ["c"])).toBe(false);
  });
});

describe("isIntegerInRange", () => {
  it.each([[1, 1, 3], [3, 1, 3], [2, 1, 3], [10 ** 20, 0, Infinity]])("accepts %d in %d..%d", (value, min, max) => {
    expect(isIntegerInRange(value, min, max)).toBe(true);
  });

  it("has no upper bound by default", () => {
    expect(isIntegerInRange(Number.MAX_SAFE_INTEGER + 1, 1)).toBe(true);
  });

  it.each([[0, 1, 3], [4, 1, 3], [1.5, 1, 3], [Infinity, 0, Infinity], [NaN, 0, 3]])("refuses %d in %d..%d", (value, min, max) => {
    expect(isIntegerInRange(value, min, max)).toBe(false);
  });

  it.each(["2", null, true, [2]])("refuses %j", (value) => {
    expect(isIntegerInRange(value, 0, 3)).toBe(false);
  });
});

describe("isIsoDate", () => {
  it.each(["2026-11-14", "2024-02-29", "0100-01-01", "9999-12-31"])("accepts %s", (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(["2026-02-30", "2023-02-29", "2026-13-01", "2026-00-10", "2026-1-01", "2026-11-14T00:00:00Z", 20261114])(
    "refuses %j",
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );

  it.each(["0000-01-01", "0099-12-31"])("refuses %s, a year Date.UTC moves to the 1900s", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe("isStringList", () => {
  it.each([[[]], [["a", " "]], [["a", "a"]]])("accepts %j of non-empty strings", (value) => {
    expect(isStringList(value)).toBe(true);
  });

  it.each([[[""]], [["a", 1]], ["a"], [null]])("refuses %j", (value) => {
    expect(isStringList(value)).toBe(false);
  });

  it("checks items with the given rule", () => {
    expect(isStringList(["Q1"], isQid)).toBe(true);
    expect(isStringList(["a", " "], isNonBlankString)).toBe(false);
  });

  it("skips the holes of a sparse list, as every does", () => {
    // The second slot is a hole, not undefined: JSON never makes one.
    const sparse = ["a", , "b"];
    expect(isStringList(sparse)).toBe(true);
  });
});

describe("hasDistinctItems", () => {
  it.each([[[]], [["a", "b"]], [[1, "1"]]])("accepts %j", (value) => {
    expect(hasDistinctItems(value)).toBe(true);
  });

  it.each([[["a", "a"]], [[NaN, NaN]], [[1, 2, 1]]])("refuses %j", (value) => {
    expect(hasDistinctItems(value)).toBe(false);
  });
});
