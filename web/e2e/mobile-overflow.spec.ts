import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { routeCrosswordDaily } from "./helpers/crossword-daily";

// The 8x7 board published on 2026-11-07. The pilot board has 3 columns, so
// it never showed that a wide grid pushed the page sideways on phones.
const wideBoard = JSON.parse(readFileSync(new URL("./fixtures/crossword-wide-board.json", import.meta.url), "utf8"));

const PHONES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

/** Elements of the game that end past the viewport's right edge. */
async function overflowing(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) => {
    const width = document.documentElement.clientWidth;
    return elements
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.right > width + 0.5 || rect.left < -0.5))
      .map(({ element, rect }) => `${element.className} [${Math.round(rect.left)}, ${Math.round(rect.right)}] > ${width}`);
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(clientWidth);
}

for (const viewport of PHONES) {
  test(`crossword ${viewport.width}px: a wide grid fits the screen`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    await routeCrosswordDaily(page, wideBoard);
    await page.goto(joinBaseUrl(baseURL!, "/pt-br/cruzadinha/"));
    await expect(page.locator("#crossword input")).toHaveCount(wideBoard.cells.length);

    await expectNoSidewaysScroll(page);
    expect(await overflowing(page, ".crossword-cell, .crossword-block, .crossword-active-clue")).toEqual([]);
    // Every square stays inside the card and big enough to tap (WCAG 2.5.8: 24px).
    const squares = await page.locator(".crossword-cell").evaluateAll((cells) => {
      const card = cells[0]!.closest(".game-card")!.getBoundingClientRect();
      return cells.map((cell) => {
        const rect = cell.getBoundingClientRect();
        return { inside: rect.left >= card.left && rect.right <= card.right, size: Math.min(rect.width, rect.height) };
      });
    });
    expect(squares.every((square) => square.inside), "squares outside the card").toBe(true);
    expect(Math.min(...squares.map((square) => square.size))).toBeGreaterThanOrEqual(24);

    // Typing still lands in the clicked square.
    const first = page.locator("#crossword input").first();
    await first.click();
    await page.keyboard.type("v");
    await expect(first).toHaveValue("V");
  });

  test(`connections ${viewport.width}px: the four controls stay on screen`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    await page.goto(joinBaseUrl(baseURL!, "/pt-br/conexoes/"));
    await expectBoardDirectReady(page);

    await expectNoSidewaysScroll(page);
    await expect(page.locator(".connections-controls .btn")).toHaveCount(4);
    expect(await overflowing(page, ".connections-controls, .connections-controls .btn")).toEqual([]);
  });
}
