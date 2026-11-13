import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { RESULT_GUARD_MS } from "../src/components/Results/use-result-action-guard";
import { pilotBoard, routeCrosswordDaily } from "./helpers/crossword-daily";

/**
 * A wrong check points at the squares to fix and leaves the player where they
 * were; a second tap or click on a crossing switches its word (NYT Mini).
 * The pilot board: 1 Across BTS and 1 Down BTOB start at row 1, column 1;
 * 2 Down SISTAR starts at row 1, column 3.
 */

const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const locales = {
  pt: {
    path: "/pt-br/cruzadinha/",
    across: "Horizontal",
    down: "Vertical",
    square: (row: number, col: number) => new RegExp(`^Linha ${row}, coluna ${col}\\.`),
    check: "Verificar respostas",
    wrong: "9 quadrados a corrigir.",
    reveal: "Revelar respostas",
    confirmReveal: "Sim, revelar",
    share: "Compartilhar resultado",
    copied: "Resultado copiado.",
  },
  en: {
    path: "/en/crossword/",
    across: "Across",
    down: "Down",
    square: (row: number, col: number) => new RegExp(`^Row ${row}, column ${col}\\.`),
    check: "Check answers",
    wrong: "9 squares to fix.",
    reveal: "Reveal answers",
    confirmReveal: "Yes, reveal",
    share: "Share result",
    copied: "Result copied.",
  },
} as const;
type Copy = (typeof locales)[keyof typeof locales];

const phones = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
] as const;

async function open(browser: Browser, baseURL: string, path: string, viewport: { width: number; height: number }) {
  const touch = viewport.width < 600;
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort()));
  await routeCrosswordDaily(context);
  const page = await context.newPage();
  await page.goto(joinBaseUrl(baseURL, prefix + path));
  await expect(page.locator("#crossword input")).toHaveCount(pilotBoard.cells.length);
  const press = (target: Locator) => (touch ? target.tap() : target.click());
  return { context, page, board: page.locator("#crossword"), press };
}

/** Every square of the grid sits whole between the top of the screen and the top of a sticky bar. */
async function gridUncovered(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".crossword-actions")!;
    const edge = getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().top : innerHeight;
    const squares = [...document.querySelectorAll<HTMLInputElement>("#crossword input")].map((input) => input.getBoundingClientRect());
    return { edge, top: Math.min(...squares.map((r) => r.top)), bottom: Math.max(...squares.map((r) => r.bottom)), barHeight: bar.getBoundingClientRect().height };
  });
}

function activeClue(board: Locator) {
  return board.getByTestId("crossword-active-clue");
}

for (const [locale, t] of Object.entries(locales) as [string, Copy][]) {
  for (const phone of phones) {
    test(`${locale} ${phone.width}x${phone.height}: a wrong check marks the squares and keeps focus, clue and grid in place`, async ({ browser, baseURL }) => {
      const { context, page, board, press } = await open(browser, baseURL!, t.path, phone);
      await press(board.getByRole("button", { name: new RegExp(`^1 ${t.across}:`) }));
      await page.keyboard.type("bxs");
      // Typing leaves focus on the S; the cursor goes back to the X.
      const cursor = board.getByRole("textbox", { name: t.square(1, 2) });
      await press(cursor);
      await expect(activeClue(board)).toContainText(`1 ${t.across}`);
      const clue = await activeClue(board).textContent();

      // The lowest square right above the bar, the grid whole on screen.
      await board.locator("input").last().evaluate((el) => el.scrollIntoView({ block: "end" }));
      const before = await gridUncovered(page);
      expect(before.top, "the grid fits above the bar").toBeGreaterThanOrEqual(0);
      expect(before.bottom).toBeLessThanOrEqual(before.edge + 0.5);

      await press(board.getByRole("button", { name: t.check, exact: true }));
      await expect(board.getByRole("status")).toHaveText(t.wrong);
      // X in BTS, the 3 empty squares of BTOB and the 5 of SISTAR.
      await expect(board.locator('input[aria-invalid="true"]')).toHaveCount(9);
      await expect(board.getByRole("textbox", { name: t.square(1, 2) })).toHaveAttribute("aria-invalid", "true");
      await expect(board.getByRole("textbox", { name: t.square(1, 1) })).not.toHaveAttribute("aria-invalid");
      await expect(board.locator(".crossword-cell.is-wrong")).toHaveCount(9);
      await expect(cursor).toBeFocused();
      await expect(activeClue(board)).toHaveText(clue!);

      const after = await gridUncovered(page);
      expect(after.barHeight, "the verdict does not grow the bar").toBeLessThanOrEqual(before.barHeight + 0.5);
      expect(after.top, "the top of the grid stays on screen").toBeGreaterThanOrEqual(0);
      expect(after.bottom, "the bar does not cover the grid").toBeLessThanOrEqual(after.edge + 0.5);

      // Typing goes on in the focused square; fixing it drops its mark.
      await page.keyboard.type("t");
      await expect(cursor).toHaveValue("T");
      await expect(cursor).not.toHaveAttribute("aria-invalid");
      await expect(board.locator('input[aria-invalid="true"]')).toHaveCount(8);
      await context.close();
    });
  }
}

for (const viewport of [...phones, { width: 1440, height: 900 }]) {
  const how = viewport.width < 600 ? "tap" : "click";
  test(`${viewport.width}x${viewport.height}: a second ${how} on a crossing switches across and down`, async ({ browser, baseURL }) => {
    const t = locales.pt;
    const { context, board, press } = await open(browser, baseURL!, t.path, viewport);
    const crossing = board.getByRole("textbox", { name: t.square(1, 1) });
    const acrossClue = board.getByRole("button", { name: new RegExp(`^1 ${t.across}:`) });
    const downClue = board.getByRole("button", { name: new RegExp(`^1 ${t.down}:`) });
    await press(crossing);
    await expect(crossing).toBeFocused();
    await expect(activeClue(board)).toContainText(`1 ${t.across}`);
    await press(crossing);
    await expect(activeClue(board)).toContainText(`1 ${t.down}`);
    await expect(downClue).toHaveAttribute("aria-pressed", "true");
    await expect(crossing).toBeFocused();
    await press(crossing);
    await expect(activeClue(board)).toContainText(`1 ${t.across}`);
    await expect(acrossClue).toHaveAttribute("aria-pressed", "true");
    // A square of one word only keeps it.
    const single = board.getByRole("textbox", { name: t.square(2, 1) });
    await press(single);
    await press(single);
    await expect(activeClue(board)).toContainText(`1 ${t.down}`);
    await context.close();
  });
}

for (const phone of phones) {
  test(`${phone.width}x${phone.height}: picking a clue below the grid brings the active clue and the grid back on screen`, async ({ browser, baseURL }) => {
    const t = locales.pt;
    const { context, page, board, press } = await open(browser, baseURL!, t.path, phone);
    // The last clue sits under the bar until the page scrolls to it.
    await press(board.getByRole("button", { name: new RegExp(`^2 ${t.down}:`) }));
    await expect(board.getByRole("textbox", { name: t.square(1, 3) })).toBeFocused();
    await expect(activeClue(board)).toContainText(`2 ${t.down}`);
    const clueTop = await activeClue(board).evaluate((el) => el.getBoundingClientRect().top);
    expect(clueTop, "the active clue is on screen").toBeGreaterThanOrEqual(0);
    const grid = await gridUncovered(page);
    expect(grid.top, "the first row is on screen").toBeGreaterThanOrEqual(0);
    expect(grid.bottom, "the bar does not cover the grid").toBeLessThanOrEqual(grid.edge + 0.5);
    await context.close();
  });
}

for (const viewport of [phones[0], { width: 1440, height: 900 }]) {
  const how = viewport.width < 600 ? "tap" : "click";
  test(`${viewport.width}x${viewport.height}: a letter typed after a second ${how} on a filled crossing replaces it`, async ({ browser, baseURL }) => {
    const t = locales.pt;
    const { context, page, board, press } = await open(browser, baseURL!, t.path, viewport);
    const crossing = board.getByRole("textbox", { name: t.square(1, 1) });
    await press(crossing);
    await page.keyboard.type("q");
    await expect(crossing).toHaveValue("Q");
    // Back to the Q, then again to switch to 1 Down.
    await press(crossing);
    await press(crossing);
    await expect(activeClue(board)).toContainText(`1 ${t.down}`);
    await page.keyboard.type("b");
    await expect(crossing).toHaveValue("B");
    await expect(board.getByRole("textbox", { name: t.square(2, 1) })).toHaveValue("");
    await expect(board.getByRole("textbox", { name: t.square(1, 2) })).toHaveValue("");
    await expect(board.getByRole("textbox", { name: t.square(2, 1) })).toBeFocused();
    await context.close();
  });
}

for (const [locale, t] of Object.entries(locales) as [string, Copy][]) {
  test(`${locale} 1440x900: Tab goes to the next square, row by row`, async ({ browser, baseURL }) => {
    const { context, page, board } = await open(browser, baseURL!, t.path, { width: 1440, height: 900 });
    await board.getByRole("textbox", { name: t.square(1, 1) }).focus();
    for (const [row, col] of [[1, 2], [1, 3], [2, 1], [2, 3]] as const) {
      await page.keyboard.press("Tab");
      await expect(board.getByRole("textbox", { name: t.square(row, col) })).toBeFocused();
    }
    await context.close();
  });
}

for (const [locale, t] of Object.entries(locales) as [string, Copy][]) {
  test(`${locale} 390x844: the share confirmation shows on screen`, async ({ browser, baseURL }) => {
    const { context, page, board, press } = await open(browser, baseURL!, t.path, { width: 390, height: 844 });
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });
    });
    await press(board.getByRole("button", { name: t.reveal, exact: true }));
    await press(page.getByRole("button", { name: t.confirmReveal, exact: true }));
    await page.waitForTimeout(RESULT_GUARD_MS + 100);
    await press(board.getByRole("button", { name: t.share, exact: true }));
    const confirmation = board.getByRole("button", { name: t.copied, exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toBeInViewport();
    await context.close();
  });
}
