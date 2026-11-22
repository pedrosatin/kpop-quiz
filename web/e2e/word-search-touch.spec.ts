import type { Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { gridPositionAt, nearestCell } from "../src/components/WordSearch/geometry";
import { getMessages } from "../src/i18n/catalog";
import { expect, test } from "./fixtures/consent-build";
import { matrixCases } from "./helpers/pairwise";
import { LOCAL_BUILD_TAG } from "./target";
import { fixedWordSearch, serveFixedWordSearch } from "./helpers/fixed-daily";

// Each test opens its own page and writes nowhere shared, so the file can
// spread its tests across workers (see playwright.config.ts).
test.describe.configure({ mode: "parallel" });

/**
 * Word search on a touch phone: a tap at the center of a cell marks that
 * cell, a drag stays straight while the finger strays, every selection that
 * does not count says why in the live region, a marked start can be
 * cancelled, and the whole word list shows without a sideways scroll while
 * the bar and the consent banner leave the last rows of the grid in reach.
 * The frozen word-search fixture is served before navigation.
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
  await serveFixedWordSearch(page);
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

// Two dimensions of size 2: pairwise equals the full product (4 × 6 = 24).
const touchMatrix = matrixCases({
  locale: locales.map((entry) => entry.id),
  phone: phones.map((phone) => String(phone.width)),
});

for (const row of touchMatrix) {
  const { id, locale, path } = locales.find((entry) => entry.id === row.locale)!;
  const phone = phones.find((entry) => String(entry.width) === row.phone)!;
  const t = getMessages(locale).wordSearch;
    test.describe(`word search touch ${id} ${phone.width}x${phone.height}`, { tag: LOCAL_BUILD_TAG }, () => {
      test.use({ viewport: phone, isMobile: true, hasTouch: true });

      test("a tap at the center of each cell marks that cell, and a tap in a gap the nearest one", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const { rows, cols } = await page.locator(".word-search-grid").evaluate((grid) => ({
          rows: Number(getComputedStyle(grid).getPropertyValue("--grid-rows")),
          cols: Number(getComputedStyle(grid).getPropertyValue("--grid-cols")),
        }));
        // Every cell is checked without touching: one evaluate reads each
        // cell's center and what elementFromPoint finds there (the layout's own
        // hit-test), and the grid's own mapping (gridPositionAt and nearestCell,
        // which selection.test.ts covers on made-up boxes) runs on those real
        // boxes. A real tap goes only to a sample, so the 288 taps (each one
        // re-rendering the grid, and a timeout on a CI runner busy with four
        // workers) become a few. Centers are measured at the start and again
        // at the end: the grid must stay put while it is tapped.
        const measure = () => page.locator(".word-search-cell").evaluateAll((cells) => cells.map((cell) => {
          const r = cell.getBoundingClientRect();
          const { row, col } = (cell as HTMLElement).dataset;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest<HTMLElement>(".word-search-cell");
          return {
            row: Number(row),
            col: Number(col),
            box: { left: r.left, top: r.top, width: r.width, height: r.height },
            hit: hit ? `${hit.dataset.row},${hit.dataset.col}` : "none",
          };
        }));
        const before = await measure();
        const box = (row: number, col: number) => before.find((cell) => cell.row === row && cell.col === col)!.box;
        const dimensions = { rows, cols };
        const unreached: string[] = [];
        const misplaced: string[] = [];
        for (const { row, col, box: own, hit } of before) {
          if (hit !== `${row},${col}`) unreached.push(`${row},${col} -> ${hit}`);
          const found = gridPositionAt(box(0, 0), box(rows - 1, cols - 1), dimensions, own.left + own.width / 2, own.top + own.height / 2);
          const cell = found && nearestCell(found, dimensions);
          if (!cell || cell.row !== row || cell.col !== col) misplaced.push(`${row},${col} -> ${cell ? `${cell.row},${cell.col}` : "none"}`);
        }
        expect(before, "every cell is in the grid").toHaveLength(rows * cols);
        expect(unreached, "cells whose center belongs to another element").toEqual([]);
        expect(misplaced, "cells whose center the grid maps to another cell").toEqual([]);

        // The real taps: the four corners and the main diagonal, a tap to mark
        // each cell and a second one on it to cancel. touchStart and touchEnd go
        // together on one CDP session: the same touch events, half the waiting.
        const sample = new Set([`0,${cols - 1}`, `${rows - 1},0`, `${rows - 1},${cols - 1}`]);
        for (let i = 0; i < Math.min(rows, cols); i++) sample.add(`${i},${i}`);
        const anchors = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".word-search-cell.is-anchor")]
          .map((cell) => `${cell.dataset.row},${cell.dataset.col}`).join(" "));
        const missed: string[] = [];
        const cdp = await page.context().newCDPSession(page);
        const tap = (point: Point) => Promise.all([
          cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }),
          cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
        ]);
        try {
          for (const key of sample) {
            const own = before.find((cell) => `${cell.row},${cell.col}` === key)!.box;
            const center = { x: own.left + own.width / 2, y: own.top + own.height / 2 };
            await tap(center);
            const marked = await anchors();
            if (marked !== key) missed.push(`${key} -> ${marked || "none"}`);
            // A second tap on the start cancels it.
            await tap(center);
          }
        } finally {
          await cdp.detach();
        }
        expect(missed, "cells whose center tap marked another cell").toEqual([]);
        expect(await measure(), "the grid stays put while it is tapped").toEqual(before);
        await expect(page.locator(".word-search-cell.is-anchor")).toHaveCount(0);

        // The gap between columns 3 and 4, a little nearer column 3.
        const a = (await page.locator(cellSelector(2, 3)).boundingBox())!;
        const b = (await page.locator(cellSelector(2, 4)).boundingBox())!;
        await page.touchscreen.tap(a.x + a.width + (b.x - a.x - a.width) * 0.4, a.y + a.height / 2);
        await expect(page.locator(cellSelector(2, 3))).toHaveClass(/is-anchor/);
      });

      test("a drag that strays beside the line still finds the name", async ({ page, consentURL }) => {
        await open(page, consentURL + path, "rejected");
        const puzzle = fixedWordSearch;
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
        const puzzle = fixedWordSearch;
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
