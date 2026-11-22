import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { settleEffects } from "./helpers/passive-effects";
import { cardIds, savedOrder } from "./helpers/timeline-board";
import { serveFixedTimeline } from "./helpers/fixed-daily";

// Drags the first card with the mouse to the last position while the page
// scrolls, in a window too short to show the whole board.
//
// In a 360 px window the sticky action bar (.timeline-controls) covers the
// bottom band, so the browser's drag autoscroll zone at the bottom edge sits
// on the bar, and the last card scrolls in from under it. The bar does not
// cancel dragover, so it does not accept a drop, and releasing there fires
// dragend and no drop. A drag that aims at a card point measured inside the
// viewport but under the bar, while the page is still scrolling, ends on the
// bar and leaves the order alone. That is how a synthetic drag failed in the
// review of #417 (scroll 435 to 452, no drop). The game took the drop in every
// run whose pointer ended on the card above the bar, scrolled by the edge
// autoscroll or by the wheel, so the helpers below re-measure the card on
// every step and only aim at the part the bar leaves visible.
// Compact play cards fit a 500 px window, so this suite uses 360 px to keep
// the last card out of reach until the page scrolls.
//
// Firefox under Playwright does not autoscroll during a drag: with the pointer
// held at the bottom edge for 300 moves, scrollY stayed put. The wheel scrolls
// the page during the drag in both browsers, so the wheel test runs in both,
// and the edge autoscroll test runs in Chromium only.

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const locales = [
  { id: "pt", path: "/pt-br/linha-do-tempo/" },
  { id: "en", path: "/en/timeline/" },
] as const;

const LAST = 4;
const STEP_PX = 8;

test.use({ viewport: { width: 1280, height: 360 } });

/**
 * The y of the card's title center when the mouse can drop on it: inside the
 * viewport and above the sticky action bar. Null while the card is out of reach.
 */
function dropY(page: Page, index: number): Promise<number | null> {
  return page.evaluate((index) => {
    const title = document.querySelectorAll(".timeline-card")[index]!.querySelector(".timeline-card-title")!;
    const box = title.getBoundingClientRect();
    const bar = document.querySelector(".timeline-controls")?.getBoundingClientRect();
    const floor = bar && bar.top > 0 && bar.top < innerHeight ? bar.top : innerHeight;
    const y = box.top + box.height / 2;
    return y > 0 && y < floor ? y : null;
  }, index);
}

/** Press on a card's title and move past the drag threshold; returns the pointer. */
async function startDrag(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(".timeline-card").nth(index).locator(".timeline-card-title").boundingBox();
  expect(box, `card ${index} has a box`).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + STEP_PX, y + STEP_PX, { steps: 4 });
  return { x: x + STEP_PX, y: y + STEP_PX };
}

/** Move the held mouse onto a card in short steps, re-measuring it each step as an eye would. */
async function followToCard(page: Page, pointer: { x: number; y: number }, index: number): Promise<void> {
  let { y } = pointer;
  for (let step = 0; step < 120; step++) {
    const target = await dropY(page, index);
    expect(target, `card ${index + 1} stays above the action bar`).not.toBeNull();
    if (Math.abs(target! - y) < 1) return;
    y += Math.max(-STEP_PX, Math.min(STEP_PX, target! - y));
    await page.mouse.move(pointer.x, y);
  }
  throw new Error(`the mouse did not reach card ${index + 1}`);
}

/** The order expected after moving the card at `from` to `to`. */
function moved(order: readonly string[], from: number, to: number): string[] {
  const next = [...order];
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card!);
  return next;
}

async function openBoardAtFirstCard(page: Page, _baseURL: string, path: string): Promise<{ opening: string[]; scrollY: number }> {
  await serveFixedTimeline(page);
  await page.goto(`${base}${path}`);
  await expectBoardDirectReady(page);
  await page.locator(".timeline-card").first().evaluate((card) => card.scrollIntoView({ block: "start" }));
  const opening = await cardIds(page);
  expect(opening).toHaveLength(LAST + 1);
  expect(await savedOrder(page)).toBeNull();
  expect(await dropY(page, LAST), "the last card starts out of reach").toBeNull();
  return { opening, scrollY: await page.evaluate(() => scrollY) };
}

async function expectDroppedLast(page: Page, opening: string[], scrollYBefore: number): Promise<void> {
  expect(await page.evaluate(() => scrollY), "the page scrolled during the drag").toBeGreaterThan(scrollYBefore);
  await page.mouse.up();
  const expected = moved(opening, 0, LAST);
  await expect.poll(() => cardIds(page)).toEqual(expected);
  await settleEffects(page);
  expect(await savedOrder(page)).toEqual(expected);
}

for (const locale of locales) {
  test(`timeline drops the first card on the last one after the wheel scrolls during the drag (${locale.id})`, async ({ page, baseURL }) => {
    const { opening, scrollY } = await openBoardAtFirstCard(page, baseURL!, locale.path);

    const pointer = await startDrag(page, 0);
    for (let turn = 0; turn < 10 && (await dropY(page, LAST)) === null; turn++) {
      await page.mouse.wheel(0, 120);
      // A move after the wheel delivers a dragover at the scrolled position.
      await page.mouse.move(pointer.x, pointer.y);
    }
    await followToCard(page, pointer, LAST);

    await expectDroppedLast(page, opening, scrollY);
  });

  test(`timeline drops the first card on the last one after the bottom edge autoscrolls the page (${locale.id})`, async ({ page, baseURL, browserName }) => {
    test.skip(browserName !== "chromium", "Only Chromium autoscrolls at the edge under Playwright; WebKit is not measured");
    const { opening, scrollY } = await openBoardAtFirstCard(page, baseURL!, locale.path);

    const pointer = await startDrag(page, 0);
    const edge = page.viewportSize()!.height - 5;
    for (; pointer.y < edge; pointer.y = Math.min(edge, pointer.y + 2 * STEP_PX)) {
      await page.mouse.move(pointer.x, pointer.y);
    }
    // Chromium scrolls while the pointer rests on the edge; each move keeps the drag alive.
    for (let nudge = 0; nudge < 300 && (await dropY(page, LAST)) === null; nudge++) {
      await page.mouse.move(pointer.x + (nudge % 2), edge);
    }
    await followToCard(page, pointer, LAST);

    await expectDroppedLast(page, opening, scrollY);
  });
}
