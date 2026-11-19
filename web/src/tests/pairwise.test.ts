import { describe, expect, it } from "vitest";
import {
  coveredPairs,
  matrixCases,
  QUIZ_CLUES_PAIRWISE,
  quizCluesFullMatrix,
  quizCluesMatrix,
  quizCluesPairRow,
  useFullMatrix,
} from "../../e2e/helpers/pairwise";

describe("useFullMatrix", () => {
  it("is off by default and on for 1 or true", () => {
    expect(useFullMatrix({})).toBe(false);
    expect(useFullMatrix({ E2E_FULL_MATRIX: "0" })).toBe(false);
    expect(useFullMatrix({ E2E_FULL_MATRIX: "1" })).toBe(true);
    expect(useFullMatrix({ E2E_FULL_MATRIX: "true" })).toBe(true);
  });
});

describe("matrixCases", () => {
  const dims = {
    locale: ["pt", "en"],
    viewport: ["360", "390", "1280"],
    consent: ["open", "rejected"],
  } as const;

  it("returns the cartesian product when full is requested", () => {
    const rows = matrixCases(dims, { full: true });
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => `${row.locale}|${row.viewport}|${row.consent}`)).size).toBe(12);
  });

  it("covers every value and every pair with fewer rows than the product", () => {
    const full = matrixCases(dims, { full: true });
    const subset = matrixCases(dims, { full: false });
    expect(subset.length).toBeLessThan(full.length);
    expect(subset).toHaveLength(6);

    for (const key of Object.keys(dims) as (keyof typeof dims)[]) {
      expect(new Set(subset.map((row) => row[key]))).toEqual(new Set(dims[key]));
    }

    const required = new Set<string>();
    for (const row of full) {
      for (const pair of coveredPairs([row.locale, row.viewport, row.consent])) required.add(pair);
    }
    const got = new Set<string>();
    for (const row of subset) {
      for (const pair of coveredPairs([row.locale, row.viewport, row.consent])) got.add(pair);
    }
    expect([...required].filter((pair) => !got.has(pair))).toEqual([]);
  });

  it("leaves a 2×2 matrix unchanged, because pairwise equals the product", () => {
    const rows = matrixCases({ locale: ["pt", "en"], phone: ["360", "390"] }, { full: false });
    expect(rows).toHaveLength(4);
  });
});

describe("quizCluesMatrix", () => {
  it("lists 72 cases on the full matrix and only rejects the banner on daily", () => {
    const full = quizCluesFullMatrix();
    expect(full).toHaveLength(72);
    expect(full.filter((row) => row.consent === "rejected").every((row) => row.scenario === "daily")).toBe(true);
  });

  it("lists the 18 pairwise cases by default", () => {
    expect(quizCluesMatrix({ full: false })).toEqual([...QUIZ_CLUES_PAIRWISE]);
    expect(QUIZ_CLUES_PAIRWISE).toHaveLength(18);
  });

  it("covers every published session once", () => {
    const sessions = new Set(
      QUIZ_CLUES_PAIRWISE.map((row) => `${row.locale}|${row.mode}|${row.scenario}`),
    );
    expect(sessions.size).toBe(18);
  });

  it("covers every value-pair of the 72-case matrix", () => {
    const required = new Set<string>();
    for (const row of quizCluesFullMatrix()) {
      for (const pair of coveredPairs(quizCluesPairRow(row))) required.add(pair);
    }
    const got = new Set<string>();
    for (const row of QUIZ_CLUES_PAIRWISE) {
      for (const pair of coveredPairs(quizCluesPairRow(row))) got.add(pair);
    }
    expect(required.size).toBe(53);
    expect([...required].filter((pair) => !got.has(pair))).toEqual([]);
  });

  it("expands to the full matrix when full is requested", () => {
    expect(quizCluesMatrix({ full: true })).toEqual(quizCluesFullMatrix());
  });
});
