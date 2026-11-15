import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { skipUnlessPublished } from "./helpers/published";
import { settleEffects } from "./helpers/passive-effects";
import { cardIds, savedOrder } from "./helpers/timeline-board";

// Orders the Timeline with the keyboard in common laptop windows.
//
// The card moved by a ↑ or ↓ button keeps focus on its own button. In
// 1280x720 the sticky action bar (.timeline-controls) covers the bottom of
// the screen. A card moved to the end used to stay partly under it, because
// the browser scrolled the page only until the focused ↑ button fitted above
// the bar, and the card's title, lower down, stayed under the bar. The board
// now scrolls the whole moved card into view above the bar, and a card already
// in view leaves the page where it is.

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const PATH = "/pt-br/linha-do-tempo/";

const LAST = 4;
/** Rounding slack: the scroll margin above the bar is the bar height rounded up. */
const EPSILON_PX = 1;

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
] as const;

interface Rect {
  top: number;
  bottom: number;
}

function rectOf(page: Page, selector: string): Promise<Rect> {
  return page.evaluate((selector) => {
    const { top, bottom } = document.querySelector(selector)!.getBoundingClientRect();
    return { top, bottom };
  }, selector);
}

function focusedRect(page: Page): Promise<Rect & { id: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const { top, bottom } = el.getBoundingClientRect();
    return { id: el.id, top, bottom };
  });
}

/** Lets the board's effects and the sticky bar's focus frame run. */
async function settle(page: Page): Promise<void> {
  await settleEffects(page);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function openBoard(page: Page, baseURL: string): Promise<string[]> {
  await skipUnlessPublished(page, baseURL, "timeline.daily.json");
  await page.goto(`${base}${PATH}`);
  await expectBoardDirectReady(page);
  const opening = await cardIds(page);
  expect(opening).toHaveLength(LAST + 1);
  expect(await savedOrder(page)).toBeNull();
  return opening;
}

async function pressMove(page: Page, id: string, direction: "up" | "down", times: number): Promise<void> {
  await page.locator(`#timeline-move-${direction}-${id}`).focus();
  for (let i = 0; i < times; i++) {
    await page.keyboard.press("Enter");
    await settle(page);
  }
}

/** The focused button and the moved card's title both end above the bar and in view. */
async function expectCardAboveBar(page: Page, id: string, focusId: string): Promise<void> {
  const bar = await rectOf(page, ".timeline-controls");
  const focused = await focusedRect(page);
  const title = await rectOf(page, `[data-testid="timeline-card-${id}"] .timeline-card-title`);
  const card = await rectOf(page, `[data-testid="timeline-card-${id}"]`);
  test.info().annotations.push({
    type: "measure",
    description: `bar ${bar.top}; focus ${focused.top}-${focused.bottom}; title ${title.top}-${title.bottom}; card ${card.top}-${card.bottom}; scrollY ${await page.evaluate(() => scrollY)}`,
  });
  expect(focused.id, "focus stays on the moved card's button").toBe(focusId);
  expect(focused.bottom, "the focused button sits above the bar").toBeLessThanOrEqual(bar.top + EPSILON_PX);
  expect(title.bottom, "the card's title sits above the bar").toBeLessThanOrEqual(bar.top + EPSILON_PX);
  expect(card.bottom, "the whole card sits above the bar").toBeLessThanOrEqual(bar.top + EPSILON_PX);
  expect(card.top, "the card is in view").toBeGreaterThanOrEqual(-EPSILON_PX);
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test(`timeline keeps the card moved to the end by the keyboard above the bar (${viewport.width}x${viewport.height})`, async ({ page, baseURL }) => {
      const opening = await openBoard(page, baseURL!);
      const id = opening[0]!;

      await pressMove(page, id, "down", LAST);

      expect(await cardIds(page)).toEqual([...opening.slice(1), id]);
      expect(await savedOrder(page)).toEqual([...opening.slice(1), id]);
      await expectCardAboveBar(page, id, `timeline-move-up-${id}`);
    });

    test(`timeline keeps the card moved to the top by the keyboard in view (${viewport.width}x${viewport.height})`, async ({ page, baseURL }) => {
      const opening = await openBoard(page, baseURL!);
      const id = opening[1]!;
      // Scroll until the first card is partly above the screen.
      const first = await rectOf(page, ".timeline-card");
      await page.evaluate((y) => scrollBy(0, y), first.top + (first.bottom - first.top) / 2);
      await settle(page);
      expect((await rectOf(page, ".timeline-card")).top, "the first card starts above the screen").toBeLessThan(0);

      await pressMove(page, id, "up", 1);

      expect((await cardIds(page))[0]).toBe(id);
      await expectCardAboveBar(page, id, `timeline-move-down-${id}`);
      // The page scrolls only until the card's top reaches the top of the
      // screen. Going back to the top of the page would also show the card,
      // lower down.
      const card = await rectOf(page, `[data-testid="timeline-card-${id}"]`);
      expect(card.top, "the page scrolled only as far as the card's top").toBeLessThanOrEqual(EPSILON_PX);
    });

    test(`timeline leaves the page where it is on a keyboard move between cards in view (${viewport.width}x${viewport.height})`, async ({ page, baseURL }) => {
      const opening = await openBoard(page, baseURL!);
      const id = opening[0]!;
      const bar = await rectOf(page, ".timeline-controls");
      const target = await rectOf(page, '.timeline-card:nth-child(2)');
      expect(target.bottom, "the second card is in view above the bar").toBeLessThan(bar.top);
      const scrollBefore = await page.evaluate(() => scrollY);

      await pressMove(page, id, "down", 1);
      await pressMove(page, id, "up", 1);

      expect(await cardIds(page)).toEqual(opening);
      expect(await page.evaluate(() => scrollY), "the page did not scroll").toBe(scrollBefore);
    });
  });
}
