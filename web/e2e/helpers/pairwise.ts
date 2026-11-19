/**
 * Pairwise (and full) covering of combinatorial E2E matrices.
 *
 * On a pull request the suite keeps every dimension value and every pair of
 * values, and drops combinations of three or more dimensions. The push on
 * master sets `E2E_FULL_MATRIX=1` so the same files expand to the cartesian
 * product before deploy.
 */

export type DimensionMap = Record<string, readonly string[]>;

export type MatrixRow<D extends DimensionMap> = { [K in keyof D]: D[K][number] };

/** True when the run must expand every matrix to the full product. */
export function useFullMatrix(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.E2E_FULL_MATRIX;
  return value === "1" || value === "true";
}

/** Encode one covered pair so sets can compare them. */
export function pairKey(
  leftDim: number,
  leftValue: string,
  rightDim: number,
  rightValue: string,
): string {
  return `${leftDim}:${leftValue}|${rightDim}:${rightValue}`;
}

/** Every unordered pair of (dimension index, value) that a row covers. */
export function coveredPairs(row: readonly string[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < row.length; i += 1) {
    for (let j = i + 1; j < row.length; j += 1) {
      pairs.add(pairKey(i, row[i]!, j, row[j]!));
    }
  }
  return pairs;
}

function cartesian(values: readonly (readonly string[])[]): string[][] {
  return values.reduce<string[][]>(
    (rows, dim) => rows.flatMap((row) => dim.map((value) => [...row, value])),
    [[]],
  );
}

/**
 * Greedy pairwise covering of `dimensions`. With `full` (or
 * `E2E_FULL_MATRIX`), returns the cartesian product instead.
 */
export function matrixCases<D extends DimensionMap>(
  dimensions: D,
  options: { full?: boolean } = {},
): MatrixRow<D>[] {
  const keys = Object.keys(dimensions) as (keyof D & string)[];
  const values = keys.map((key) => dimensions[key] as readonly string[]);
  const fullRows = cartesian(values);
  if (options.full ?? useFullMatrix()) {
    return fullRows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]!])) as MatrixRow<D>);
  }

  const need = new Set<string>();
  for (const row of fullRows) {
    for (const pair of coveredPairs(row)) need.add(pair);
  }

  const chosen: string[][] = [];
  const left = new Set(need);
  while (left.size > 0) {
    let best: string[] | undefined;
    let bestScore = -1;
    let bestIndex = -1;
    for (let index = 0; index < fullRows.length; index += 1) {
      const row = fullRows[index]!;
      let score = 0;
      for (const pair of coveredPairs(row)) {
        if (left.has(pair)) score += 1;
      }
      if (score > bestScore || (score === bestScore && (bestIndex < 0 || index < bestIndex))) {
        best = row;
        bestScore = score;
        bestIndex = index;
      }
    }
    if (!best || bestScore === 0) {
      throw new Error("pairwise covering stalled before covering every pair");
    }
    chosen.push(best);
    for (const pair of coveredPairs(best)) left.delete(pair);
  }

  return chosen.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]!])) as MatrixRow<D>);
}

export const QUIZ_CLUES_LOCALES = ["pt", "en"] as const;
export const QUIZ_CLUES_VIEWPORTS = ["desktop", "phone-360", "phone-390"] as const;
export const QUIZ_CLUES_MODES = ["assisted", "standard", "expert"] as const;
export const QUIZ_CLUES_SCENARIOS = ["daily", "daily-tomorrow", "decade-2000"] as const;
export const QUIZ_CLUES_CONSENTS = ["open", "rejected"] as const;

/** One cell of the quiz-clues combinatorial matrix. */
export type QuizCluesCase = {
  locale: (typeof QUIZ_CLUES_LOCALES)[number];
  viewport: (typeof QUIZ_CLUES_VIEWPORTS)[number];
  mode: (typeof QUIZ_CLUES_MODES)[number];
  scenario: (typeof QUIZ_CLUES_SCENARIOS)[number];
  consent: (typeof QUIZ_CLUES_CONSENTS)[number];
};

/**
 * Verified 18-row design: every published session (locale × mode × scenario)
 * once, with viewport and consent chosen so all 53 value-pairs of the 72-case
 * matrix are covered. Found by the search in the CI audit (`pairwise18.py`,
 * seed 7).
 */
export const QUIZ_CLUES_PAIRWISE: readonly QuizCluesCase[] = [
  { locale: "pt", viewport: "phone-360", mode: "assisted", scenario: "daily", consent: "open" },
  { locale: "pt", viewport: "phone-390", mode: "assisted", scenario: "daily-tomorrow", consent: "open" },
  { locale: "pt", viewport: "desktop", mode: "assisted", scenario: "decade-2000", consent: "open" },
  { locale: "pt", viewport: "desktop", mode: "standard", scenario: "daily", consent: "rejected" },
  { locale: "pt", viewport: "desktop", mode: "standard", scenario: "daily-tomorrow", consent: "open" },
  { locale: "pt", viewport: "phone-390", mode: "standard", scenario: "decade-2000", consent: "open" },
  { locale: "pt", viewport: "phone-390", mode: "expert", scenario: "daily", consent: "open" },
  { locale: "pt", viewport: "phone-360", mode: "expert", scenario: "daily-tomorrow", consent: "open" },
  { locale: "pt", viewport: "desktop", mode: "expert", scenario: "decade-2000", consent: "open" },
  { locale: "en", viewport: "phone-360", mode: "assisted", scenario: "daily", consent: "rejected" },
  { locale: "en", viewport: "desktop", mode: "assisted", scenario: "daily-tomorrow", consent: "open" },
  { locale: "en", viewport: "phone-390", mode: "assisted", scenario: "decade-2000", consent: "open" },
  { locale: "en", viewport: "desktop", mode: "standard", scenario: "daily", consent: "open" },
  { locale: "en", viewport: "phone-360", mode: "standard", scenario: "daily-tomorrow", consent: "open" },
  { locale: "en", viewport: "phone-360", mode: "standard", scenario: "decade-2000", consent: "open" },
  { locale: "en", viewport: "phone-390", mode: "expert", scenario: "daily", consent: "rejected" },
  { locale: "en", viewport: "phone-360", mode: "expert", scenario: "daily-tomorrow", consent: "open" },
  { locale: "en", viewport: "phone-360", mode: "expert", scenario: "decade-2000", consent: "open" },
];

/** Full 72-case quiz-clues matrix (rejected banner only on the daily game). */
export function quizCluesFullMatrix(): QuizCluesCase[] {
  const rows: QuizCluesCase[] = [];
  for (const locale of QUIZ_CLUES_LOCALES) {
    for (const viewport of QUIZ_CLUES_VIEWPORTS) {
      for (const mode of QUIZ_CLUES_MODES) {
        for (const scenario of QUIZ_CLUES_SCENARIOS) {
          for (const consent of QUIZ_CLUES_CONSENTS) {
            if (consent === "rejected" && scenario !== "daily") continue;
            rows.push({ locale, viewport, mode, scenario, consent });
          }
        }
      }
    }
  }
  return rows;
}

/** Quiz-clues cases for this run: 18 on a PR, 72 when `E2E_FULL_MATRIX` is on. */
export function quizCluesMatrix(options: { full?: boolean } = {}): QuizCluesCase[] {
  return options.full ?? useFullMatrix() ? quizCluesFullMatrix() : [...QUIZ_CLUES_PAIRWISE];
}

/** Map a quiz-clues case onto the four abstract dimensions used for pair checks. */
export function quizCluesPairRow(row: QuizCluesCase): [string, string, string, string] {
  const variant =
    row.scenario === "daily"
      ? `daily/${row.consent}`
      : row.scenario === "daily-tomorrow"
        ? "tomorrow/open"
        : "decade/open";
  return [row.locale, row.viewport, row.mode, variant];
}
