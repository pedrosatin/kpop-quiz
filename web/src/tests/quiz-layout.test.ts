// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(import.meta.dirname, "../styles");

// Every style sheet the site loads, so a rule added elsewhere is caught too.
function styleSheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return styleSheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

// Innermost rules only: a rule nested in @media still matches on its own.
function rules(css: string): Array<{ selector: string; body: string }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!,
  }));
}

// `.options` (the grid) or `.option` (an answer), not `.option-key`.
const OPTION_SELECTOR = /\.options?(?![\w-])/;

// Anything that would show the answers in another order than the DOM,
// which is the order of A, B, C, D, of Tab and of the arrow keys.
const REORDER = [
  /(^|[\s;])order\s*:/,
  /flex-direction\s*:\s*[\w-]*-reverse/,
  /grid-(area|row|column)(-start|-end)?\s*:/,
  /grid-auto-flow\s*:[^;]*column/,
];

function reorderingRules(css: string) {
  return rules(css).filter(
    ({ selector, body }) => OPTION_SELECTOR.test(selector) && REORDER.some((pattern) => pattern.test(body)),
  );
}

describe("quiz answer layout", () => {
  it("catches each way of reordering the options", () => {
    const samples = [
      ".option { order: 2; }",
      "@media (min-width: 40rem) { .options { flex-direction: row-reverse; } }",
      ".options .option:nth-child(3) { grid-area: 1 / 2; }",
      ".option { grid-row: 2; }",
      ".option { grid-column-start: 2; }",
      ".options { grid-auto-flow: column dense; }",
    ];
    for (const sample of samples) expect(reorderingRules(sample), sample).toHaveLength(1);
    expect(reorderingRules(".option-key { order: 1; } .result-stats { grid-area: stats; }")).toEqual([]);
  });

  it("keeps the options in DOM order in every style sheet", () => {
    const sheets = styleSheets(STYLES);
    const optionRules = sheets.flatMap((path) => rules(readFileSync(path, "utf-8")))
      .filter(({ selector }) => OPTION_SELECTOR.test(selector));
    // The check reads the real rules, not an empty list.
    expect(optionRules.some(({ selector }) => selector === ".options")).toBe(true);
    for (const path of sheets) {
      expect(reorderingRules(readFileSync(path, "utf-8")), path).toEqual([]);
    }
  });
});
