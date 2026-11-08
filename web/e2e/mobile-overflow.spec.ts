import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { routeCrosswordDaily } from "./helpers/crossword-daily";

// The 8x7 board published on 2026-11-07. The pilot board has 3 columns, so
// it never showed that a wide grid pushed the page sideways on phones.
const wideBoard = JSON.parse(readFileSync(new URL("./fixtures/crossword-wide-board.json", import.meta.url), "utf8"));

/**
 * The same board one column to the right: 9 columns, the widest a board may
 * be (CROSSWORD_MAX_SIDE). The entries keep their sources, crossings and
 * numbering, so the page accepts it like a published board.
 */
function shiftedOneColumn(board: typeof wideBoard): typeof wideBoard {
  return {
    ...board,
    cols: board.cols + 1,
    entries: board.entries.map((entry: { col: number }) => ({ ...entry, col: entry.col + 1 })),
    cells: board.cells.map((cell: { col: number }) => ({ ...cell, col: cell.col + 1 })),
  };
}

const BOARDS = [wideBoard, shiftedOneColumn(wideBoard)];

const PHONE_HEIGHT = 800;
// 320px is the narrowest width tested; 375px is the iPhone SE/mini.
const CROSSWORD_WIDTHS = [320, 360, 375, 390, 414] as const;
// The old 24rem breakpoint put the controls in one row from 385px; in
// Portuguese that row overflowed the card up to about 418px.
const CONNECTIONS_WIDTHS = [360, 390, 393, 400, 414] as const;
const CONNECTIONS_PATHS = ["/pt-br/conexoes/", "/en/connections/"] as const;

/** Elements of the game that end past the viewport's left or right edge. */
async function overflowing(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) => {
    const width = document.documentElement.clientWidth;
    return elements
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.right > width + 0.5 || rect.left < -0.5))
      .map(({ element, rect }) => `${element.className} [${Math.round(rect.left)}, ${Math.round(rect.right)}] > ${width}`);
  });
}

/** Elements matching selector that end outside their .game-card, left or right. */
async function outsideCard(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) => {
    return elements
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        card: element.closest(".game-card")!.getBoundingClientRect(),
      }))
      .filter(({ rect, card }) => rect.left < card.left - 0.5 || rect.right > card.right + 0.5)
      .map(({ element, rect, card }) =>
        `${element.textContent?.trim() || element.className} [${Math.round(rect.left)}, ${Math.round(rect.right)}] outside [${Math.round(card.left)}, ${Math.round(card.right)}]`);
  });
}

/**
 * Each square's letter as the page lays it out, with the widest letter an
 * answer can hold (A to Z, 0 to 9) typed in: the font size, the line box
 * (content top, one line-height tall), the glyph centered in the content box
 * and, for a numbered square, the clue number's box. Canvas measures the glyph
 * with the input's own font, after the web fonts load.
 */
async function letterGeometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator(".crossword-cell").evaluateAll((cells) => {
    const canvas = document.createElement("canvas").getContext("2d")!;
    return cells.map((cell) => {
      const input = cell.querySelector("input")!;
      const box = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      const top = parseFloat(style.paddingTop);
      const right = parseFloat(style.paddingRight);
      const bottom = parseFloat(style.paddingBottom);
      const left = parseFloat(style.paddingLeft);
      const lineHeight = parseFloat(style.lineHeight);
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const glyph = Math.max(...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].map((char) => canvas.measureText(char).width));
      const contentWidth = box.width - left - right;
      const glyphLeft = box.left + left + (contentWidth - glyph) / 2;
      const number = cell.querySelector("span")?.getBoundingClientRect();
      return {
        cell: cell.getBoundingClientRect(),
        number: number && { text: cell.querySelector("span")!.textContent, left: number.left, right: number.right, top: number.top, bottom: number.bottom },
        letter: { left: glyphLeft, right: glyphLeft + glyph, top: box.top + top, bottom: box.top + top + lineHeight },
        fontSize: parseFloat(style.fontSize),
        textAlign: style.textAlign,
        // Room the content box leaves around the line of text and the glyph.
        roomY: box.height - top - bottom - lineHeight,
        roomX: contentWidth - glyph,
      };
    });
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(clientWidth);
}

for (const board of BOARDS) {
  for (const width of CROSSWORD_WIDTHS) {
    test(`crossword ${board.cols} columns at ${width}px: the grid fits the screen`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await routeCrosswordDaily(page, board);
      await page.goto(joinBaseUrl(baseURL!, "/pt-br/cruzadinha/"));
      await expect(page.locator("#crossword input")).toHaveCount(board.cells.length);

      await expectNoSidewaysScroll(page);
      expect(await overflowing(page, ".crossword-cell, .crossword-block, .crossword-active-clue")).toEqual([]);
      expect(await outsideCard(page, ".crossword-cell")).toEqual([]);
      const squares = await letterGeometry(page);
      // Big enough to tap (WCAG 2.5.8: 24px).
      expect(Math.min(...squares.map((square) => Math.min(square.cell.width, square.cell.height)))).toBeGreaterThanOrEqual(24);
      // iOS Safari zooms into a focused input under 16px.
      expect(Math.min(...squares.map((square) => square.fontSize))).toBeGreaterThanOrEqual(16);
      // The line and the widest glyph fit inside the border, even in the
      // smallest square; 0.05px absorbs layout rounding.
      expect(Math.min(...squares.map((square) => square.roomY)), "letter taller than its square").toBeGreaterThanOrEqual(-0.05);
      expect(Math.min(...squares.map((square) => square.roomX)), "letter wider than its square").toBeGreaterThanOrEqual(-0.05);

      // Typing still lands in the clicked square.
      const first = page.locator("#crossword input").first();
      await first.click();
      await page.keyboard.type("v");
      await expect(first).toHaveValue("V");
    });

    test(`crossword ${board.cols} columns at ${width}px: the clue number stays clear of the letter`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await routeCrosswordDaily(page, board);
      await page.goto(joinBaseUrl(baseURL!, "/pt-br/cruzadinha/"));
      await expect(page.locator(".crossword-cell span")).toHaveCount(board.entries.length);

      const numbered = (await letterGeometry(page)).filter((square) => square.number);
      expect(numbered).toHaveLength(board.entries.length);
      // The letter box below assumes a centered glyph.
      expect(numbered.map((square) => square.textAlign)).toEqual(numbered.map(() => "center"));
      const clashes = numbered
        .filter(({ number, letter }) =>
          number!.left < letter.right && number!.right > letter.left && number!.top < letter.bottom && number!.bottom > letter.top)
        .map(({ number, letter }) =>
          `${number!.text}: number [${number!.left.toFixed(2)}, ${number!.right.toFixed(2)}] x [${number!.top.toFixed(2)}, ${number!.bottom.toFixed(2)}]` +
          ` meets letter [${letter.left.toFixed(2)}, ${letter.right.toFixed(2)}] x [${letter.top.toFixed(2)}, ${letter.bottom.toFixed(2)}]`);
      expect(clashes).toEqual([]);
    });
  }
}

for (const path of CONNECTIONS_PATHS) {
  for (const width of CONNECTIONS_WIDTHS) {
    test(`connections ${path} at ${width}px: the four controls stay inside the card`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await page.goto(joinBaseUrl(baseURL!, path));
      await expectBoardDirectReady(page);

      await expectNoSidewaysScroll(page);
      await expect(page.locator(".connections-controls .btn")).toHaveCount(4);
      expect(await overflowing(page, ".connections-controls, .connections-controls .btn")).toEqual([]);
      expect(await outsideCard(page, ".connections-controls .btn")).toEqual([]);
    });
  }
}
