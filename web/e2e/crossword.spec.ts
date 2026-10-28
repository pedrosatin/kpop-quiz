import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { delayPassiveEffects, settleEffects } from "./helpers/passive-effects";
import { gamePlayed } from "./helpers/player-stats";

type Entry = { number: number; direction: "across" | "down"; answer: string; canonical_name: string; row: number; col: number };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}
function checksum(p: Record<string, unknown>) {
  const { dataset_version: _ignored, ...content } = p;
  p.dataset_version = createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}

const puzzle = JSON.parse(readFileSync(new URL("../public/data/crossword-pilot.json", import.meta.url), "utf8"));
const entries: Entry[] = puzzle.entries;
const sourceCount = puzzle.entries.flatMap((e: { sources: unknown[] }) => e.sources).length;
const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const copy = {
  "pt-br": { path: "/pt-br/cruzadinha/", across: "Horizontal", down: "Vertical", check: "Verificar respostas", reveal: "Revelar respostas", confirmReveal: "Sim, revelar", wrong: "incorretas", won: "Cruzadinha concluída!", revealed: "Respostas reveladas", source: "Ver fonte", share: "Compartilhar resultado" },
  en: { path: "/en/crossword/", across: "Across", down: "Down", check: "Check answers", reveal: "Reveal answers", confirmReveal: "Yes, reveal", wrong: "incorrect", won: "Crossword completed!", revealed: "Answers revealed", source: "Show source", share: "Share result" },
} as const;

async function open(page: Page, baseURL: string | undefined, path: string) {
  await page.goto(joinBaseUrl(baseURL!, prefix + path));
  await expect(page.locator("#crossword input")).toHaveCount(puzzle.cells.length);
}

async function fill(page: Page, locale: keyof typeof copy, list: Entry[] = entries) {
  const t = copy[locale];
  const board = page.locator("#crossword");
  for (const e of list) {
    await board.getByRole("button", { name: new RegExp(`^${e.number} ${e.direction === "across" ? t.across : t.down}:`) }).click();
    await page.keyboard.type(e.answer.toLowerCase());
  }
}

for (const locale of ["pt-br", "en"] as const) {
  test(`crossword completes in ${locale} on the final route`, async ({ page, baseURL }) => {
    const t = copy[locale];
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, baseURL, t.path);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator(".game-nav-bar")).toBeVisible();
    const board = page.locator("#crossword");
    await board.getByRole("button", { name: t.check, exact: true }).click();
    await expect(board.getByRole("status")).toContainText(t.wrong);
    await fill(page, locale);
    const check = board.getByRole("button", { name: t.check, exact: true });
    // The sticky bar keeps the main action on screen.
    await expect(check).toBeInViewport();
    await check.click();
    await expect(board.getByRole("heading", { name: t.won })).toBeFocused();
    await expect(board.locator("input:enabled")).toHaveCount(0);
    await board.getByRole("button", { name: t.source }).click();
    await expect(board.locator('.crossword-source a[href*="oldid="]')).toHaveCount(sourceCount);
    for (const e of entries) await expect(board.getByRole("heading", { name: e.canonical_name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const lag of ["normal", "delayed effects"] as const) {
  test(`progress resumes after a reload and a finished round is not counted twice (${lag})`, async ({ page, baseURL }) => {
    if (lag === "delayed effects") await delayPassiveEffects(page);
    await open(page, baseURL, copy.en.path);
    await fill(page, "en", entries.slice(0, 1));
    await page.reload();
    await expect(page.locator("#crossword input")).toHaveCount(puzzle.cells.length);
    const first = entries[0]!;
    await expect(page.getByRole("textbox", { name: new RegExp(`^Row ${first.row + 1}, column ${first.col + 1}\\.`) })).toHaveValue(first.answer[0]!);
    await page.getByRole("button", { name: copy.en.reveal }).click();
    await page.getByRole("button", { name: copy.en.confirmReveal }).click();
    await expect(page.getByRole("heading", { name: copy.en.revealed })).toBeVisible();
    // The stats write is an effect that runs after the result is painted.
    await expect.poll(() => gamePlayed(page, "crossword")).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: copy.en.revealed })).toBeVisible();
    await settleEffects(page);
    expect(await gamePlayed(page, "crossword")).toBe(1);
  });
}

test("share falls back to a text field without a date or answers", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await open(page, baseURL, copy.en.path);
  await page.getByRole("button", { name: copy.en.reveal }).click();
  await page.getByRole("button", { name: copy.en.confirmReveal }).click();
  await expect(page.getByRole("heading", { name: copy.en.revealed })).toBeVisible();
  // Result buttons ignore presses for 300 ms after they replace the controls.
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: copy.en.share }).click();
  const field = page.getByRole("textbox", { name: "Result text" });
  await expect(field).toBeVisible();
  const text = await field.inputValue();
  expect(text).toContain("K-pop Crossword");
  expect(text).toContain("utm_campaign=crossword");
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test("missing and invalid boards offer retry without a fallback", async ({ page, baseURL }) => {
  let attempt = 0;
  await page.route("**/data/crossword-pilot.json", (route) => {
    attempt++;
    if (attempt === 1) return route.fulfill({ status: 404, body: "" });
    if (attempt === 2) return route.fulfill({ json: { ...puzzle, cells: [] } });
    if (attempt === 3) {
      const invalid = structuredClone(puzzle);
      invalid.entries[0].sources[0].locator = invalid.entries[0].sources[0].locator.replace(/\[\d+:\d+\]$/, "[20:10]");
      checksum(invalid);
      return route.fulfill({ json: invalid });
    }
    return route.fulfill({ json: puzzle });
  });
  await page.goto(joinBaseUrl(baseURL!, prefix + copy.en.path));
  await expect(page.getByTestId("game-missing")).toContainText("not available");
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("game-retry").click();
    await expect(page.getByTestId("game-missing")).toContainText("could not be loaded");
  }
  await page.getByTestId("game-retry").click();
  await expect(page.locator("#crossword input")).toHaveCount(puzzle.cells.length);
});

test("keyboard editing, crossed clues and digits remain playable", async ({ page, baseURL }) => {
  const numeric = structuredClone(puzzle);
  numeric.entries[1].canonical_name = "Bt0B";
  numeric.entries[1].answer = "BT0B";
  numeric.cells.find((c: { row: number; col: number }) => c.row === 2 && c.col === 0).answer = "0";
  checksum(numeric);
  await page.route("**/data/crossword-pilot.json", (route) => route.fulfill({ json: numeric }));
  await open(page, baseURL, copy.en.path);
  const board = page.locator("#crossword");
  await board.getByRole("button", { name: /^1 Down:/ }).click();
  await page.keyboard.type("ｂｔ０ｂ");
  await expect(board.getByRole("textbox", { name: /^Row 3, column 1\./ })).toHaveValue("0");
  await board.getByRole("button", { name: /^1 Across:/ }).click();
  await page.keyboard.type("xxx");
  await board.getByRole("button", { name: "Check answers", exact: true }).click();
  await expect(board.getByRole("status")).toContainText("incorrect");
  await board.getByRole("textbox", { name: /^Row 1, column 1\./ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(board.getByRole("textbox", { name: /^Row 1, column 2\./ })).toBeFocused();
  for (const e of numeric.entries as Entry[]) {
    await board.getByRole("button", { name: new RegExp(`^${e.number} ${e.direction === "across" ? "Across" : "Down"}:`) }).click();
    await page.keyboard.type(e.answer);
  }
  await board.getByRole("button", { name: "Check answers", exact: true }).click();
  await expect(board.getByTestId("game-result")).toBeVisible();
  await expect(board.getByRole("heading", { name: "Crossword completed!" })).toBeVisible();
});

test("English link keeps the player on the crossword", async ({ page, baseURL }) => {
  await open(page, baseURL, copy["pt-br"].path);
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/crossword\/$/);
  await expect(page.getByRole("heading", { name: "K-pop Crossword", level: 1 })).toBeVisible();
});
