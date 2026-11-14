import type { Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { getMessages } from "../src/i18n/catalog";
import { expect, test } from "./fixtures/consent-build";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { skipUnlessPublished } from "./helpers/published";

// Every case plays the published word search, which a day may go out without.
test.beforeEach(async ({ page, consentURL }) => {
  await skipUnlessPublished(page, consentURL, "word-search.daily.json");
});

/**
 * Word search on a touch phone: a tap at the center of a cell marks that
 * cell, a drag stays straight while the finger strays, every selection that
 * does not count says why in the live region, a marked start can be
 * cancelled, and the whole word list shows without a sideways scroll while
 * the bar and the consent banner leave the last rows of the grid in reach.
 */

interface Word {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
}

interface Daily {
  reference_date: string;
  dimensions: { rows: number; cols: number };
  words: Word[];
}

interface Point {
  x: number;
  y: number;
}

const locales = [
  { id: "pt", locale: "pt-BR", path: "/pt-br/caca-palavras/" },
  { id: "en", locale: "en", path: "/en/word-search/" },
] as const;

const phones = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
] as const;

const cellSelector = (row: number, col: number) => `.word-search-cell[data-row="${row}"][data-col="${col}"]`;

async function open(page: Page, url: string, banner: "open" | "rejected") {
  if (banner === "rejected") {
    await page.addInitScript((key) => window.localStorage.setItem(key, "rejected"), CONSENT_STORAGE_KEY);
  }
  await page.goto(url);
  await expect(page.locator(".word-search-cell").first()).toBeVisible();
  if (banner === "open") await expect(page.locator(".consent-banner")).toBeVisible();
  else await expect(page.locator(".consent-banner")).toHaveCount(0);
  // The whole grid at the top of the screen, above the bar.
  await page.locator(".word-search-grid").evaluate((el) => el.scrollIntoView({ block: "start" }));
}

async function centerOf(page: Page, row: number, col: number): Promise<Point> {
  const box = (await page.locator(cellSelector(row, col)).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function tapCell(page: Page, row: number, col: number) {
  const { x, y } = await centerOf(page, row, col);
  await page.touchscreen.tap(x, y);
}

/** A touch drag through the points, sent as raw touch events (Chromium). */
async function touchDrag(page: Page, points: Point[]) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [points[0]!] });
    for (const point of points.slice(1)) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

function cellsOf(word: Word): string[] {
  const length = Math.max(Math.abs(word.end_row - word.start_row), Math.abs(word.end_col - word.start_col)) + 1;
  const dRow = Math.sign(word.end_row - word.start_row);
  const dCol = Math.sign(word.end_col - word.start_col);
  return Array.from({ length }, (_, i) => `${word.start_row + i * dRow},${word.start_col + i * dCol}`);
}

/** Two cells side by side that no single name holds both of. */
function pairOffEveryName(puzzle: Daily): [number, number] {
  const paths = puzzle.words.map((word) => new Set(cellsOf(word)));
  for (let row = 0; row < puzzle.dimensions.rows; row++) {
    for (let col = 0; col + 1 < puzzle.dimensions.cols; col++) {
      if (!paths.some((path) => path.has(`${row},${col}`) && path.has(`${row},${col + 1}`))) return [row, col];
    }
  }
  throw new Error("every pair of neighbours belongs to a name");
}

const status = (page: Page) => page.locator(".word-search-message[role='status']");

// page.evaluate sends each function alone, so each one finds the covered
// edge (the bar, the banner or the window) by itself.
function visibleChips(): { total: number; whole: number } {
  const bar = document.querySelector(".word-search-actions")!.getBoundingClientRect();
  const consent = document.querySelector(".consent-banner")?.getBoundingClientRect();
  const edge = Math.min(bar.top, consent?.top ?? Infinity, window.innerHeight);
  const chips = [...document.querySelectorAll(".word-search-item")].map((li) => li.getBoundingClientRect());
  return {
    total: chips.length,
    whole: chips.filter((r) => r.top >= -0.5 && r.bottom <= edge + 0.5 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5).length,
  };
}

function lastRowInReach(): { whole: boolean; hit: boolean } {
  const bar = document.querySelector(".word-search-actions")!.getBoundingClientRect();
  const consent = document.querySelector(".consent-banner")?.getBoundingClientRect();
  const edge = Math.min(bar.top, consent?.top ?? Infinity, window.innerHeight);
  const last = String(document.querySelectorAll(".word-search-row").length - 1);
  const cells = [...document.querySelectorAll<HTMLElement>(".word-search-cell")].filter((cell) => cell.dataset.row === last);
  return {
    whole: cells.every((cell) => {
      const r = cell.getBoundingClientRect();
      return r.top >= -0.5 && r.bottom <= edge + 0.5;
    }),
    hit: cells.every((cell) => {
      const r = cell.getBoundingClientRect();
      return cell.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }),
  };
}

for (const { id, locale, path } of locales) {
  const t = getMessages(locale).wordSearch;

  for (const phone of phones) {
    test.describe(`word search touch ${id} ${phone.width}x${phone.height}`, () => {
      test.use({ viewport: phone, isMobile: true, hasTouch: true });

      test("a tap at the center of each cell marks that cell, and a tap in a gap the nearest one", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const { rows, cols } = await page.locator(".word-search-grid").evaluate((grid) => ({
          rows: Number(getComputedStyle(grid).getPropertyValue("--grid-rows")),
          cols: Number(getComputedStyle(grid).getPropertyValue("--grid-cols")),
        }));
        const missed: string[] = [];
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            await tapCell(page, row, col);
            const marked = await page.locator(".word-search-cell.is-anchor").evaluateAll((cells) =>
              cells.map((cell) => `${(cell as HTMLElement).dataset.row},${(cell as HTMLElement).dataset.col}`));
            if (marked.join(" ") !== `${row},${col}`) missed.push(`${row},${col} -> ${marked.join(" ") || "none"}`);
            // A second tap on the start cancels it.
            await tapCell(page, row, col);
          }
        }
        expect(missed, "cells whose center tap marked another cell").toEqual([]);
        await expect(page.locator(".word-search-cell.is-anchor")).toHaveCount(0);

        // The gap between columns 3 and 4, a little nearer column 3.
        const a = (await page.locator(cellSelector(2, 3)).boundingBox())!;
        const b = (await page.locator(cellSelector(2, 4)).boundingBox())!;
        await page.touchscreen.tap(a.x + a.width + (b.x - a.x - a.width) * 0.4, a.y + a.height / 2);
        await expect(page.locator(cellSelector(2, 3))).toHaveClass(/is-anchor/);
      });

      test("a drag that strays beside the line still finds the name", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const puzzle = await loadPreferNextDaily<Daily>(page.request, consentURL, "word-search.daily.json");
        const word = puzzle.words[0]!;
        const start = await centerOf(page, word.start_row, word.start_col);
        const end = await centerOf(page, word.end_row, word.end_col);
        const pitch = await page.locator(".word-search-cell").evaluateAll((cells) =>
          cells[1]!.getBoundingClientRect().left - cells[0]!.getBoundingClientRect().left);
        // Off the line by 40% of a cell, across it, along the whole drag.
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const across = { x: -(end.y - start.y) / length * pitch * 0.4, y: (end.x - start.x) / length * pitch * 0.4 };
        const points = [start];
        for (let i = 1; i <= 8; i++) {
          points.push({ x: start.x + (end.x - start.x) * i / 8 + across.x, y: start.y + (end.y - start.y) * i / 8 + across.y });
        }
        await touchDrag(page, points);
        await expect(page.getByTestId("found-counter")).toContainText(t.progress(1, puzzle.words.length));
        await expect(page.locator(".word-search-actions")).toHaveClass(/is-correct/);
      });

      test("a piece of a name, a tap off the line and a miss each say why in the status region", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const puzzle = await loadPreferNextDaily<Daily>(page.request, consentURL, "word-search.daily.json");
        const letter = (row: number, col: number) => page.locator(cellSelector(row, col)).locator(".cell-letter").innerText();
        const texts = new Set<string>();

        // The first two letters of a name, dragged: never a name on their own.
        const word = puzzle.words[0]!;
        const dRow = Math.sign(word.end_row - word.start_row);
        const dCol = Math.sign(word.end_col - word.start_col);
        const piece = `${await letter(word.start_row, word.start_col)}${await letter(word.start_row + dRow, word.start_col + dCol)}`;
        await touchDrag(page, [
          await centerOf(page, word.start_row, word.start_col),
          await centerOf(page, word.start_row + dRow, word.start_col + dCol),
        ]);
        await expect(status(page)).toHaveText(t.partialFeedback(piece));
        texts.add(await status(page).innerText());

        // A knight's move from the start is on none of its lines.
        const from = await letter(0, 0);
        const to = await letter(1, 2);
        await tapCell(page, 0, 0);
        await tapCell(page, 1, 2);
        await expect(status(page)).toHaveText(t.offLineFeedback(from, to));
        await expect(page.locator(cellSelector(1, 2))).toHaveClass(/is-anchor/);
        texts.add(await status(page).innerText());
        await tapCell(page, 1, 2);

        const [row, col] = pairOffEveryName(puzzle);
        const miss = `${await letter(row, col)}${await letter(row, col + 1)}`;
        await tapCell(page, row, col);
        await tapCell(page, row, col + 1);
        await expect(status(page)).toHaveText(t.missFeedback(miss));
        await expect(page.locator(".word-search-actions")).toHaveClass(/is-incorrect/);
        texts.add(await status(page).innerText());

        expect(texts.size, "three different messages").toBe(3);
        await expect(status(page)).toHaveAttribute("aria-live", "polite");
      });

      test("a second tap on the start and Esc both cancel a marked start", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const start = page.locator(cellSelector(3, 3));

        await tapCell(page, 3, 3);
        await expect(start).toHaveClass(/is-anchor/);
        await expect(status(page)).toHaveText(t.anchorHint(await start.innerText()));
        await tapCell(page, 3, 3);
        await expect(page.locator(".word-search-cell.is-anchor")).toHaveCount(0);
        await expect(status(page)).toHaveText(t.cancelFeedback);

        await tapCell(page, 3, 3);
        await expect(start).toHaveClass(/is-anchor/);
        // A tap leaves focus outside the grid; Esc still cancels.
        await page.keyboard.press("Escape");
        await expect(page.locator(".word-search-cell.is-anchor")).toHaveCount(0);
        await expect(status(page)).toHaveText(t.cancelFeedback);
      });

      for (const banner of ["open", "rejected"] as const) {
        test(`banner ${banner}: every name shows without a sideways scroll, and the last rows clear the bar`, async ({ page, consentURL }) => {
          await open(page, consentURL + path, banner);
          const list = page.locator(".word-search-words");

          for (const mode of ["hints", "names"] as const) {
            if (mode === "names") await page.locator(".toggle-mode-btn").tap();
            const fit = await list.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
            expect(fit.scroll, `${mode}: the list does not scroll sideways`).toBeLessThanOrEqual(fit.client + 1);

            // Scrolled to the end of the list: every chip whole above the bar and the banner.
            await list.evaluate((el) => el.scrollIntoView({ block: "end" }));
            const chips = await page.evaluate(visibleChips);
            expect(chips.whole, `${mode}: chips whole on screen`).toBe(chips.total);

            // Scrolled to the last row: whole above the bar and the banner, and a tap reaches it.
            const lastCell = page.locator(".word-search-cell").last();
            await lastCell.evaluate((el) => el.scrollIntoView({ block: "end" }));
            const row = await page.evaluate(lastRowInReach);
            expect(row.whole, `${mode}: the last row sits above the bar and the banner`).toBe(true);
            expect(row.hit, `${mode}: a tap on the last row reaches it`).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
          }
        });
      }
    });
  }
}
