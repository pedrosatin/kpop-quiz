import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { settleEffects } from "./helpers/passive-effects";
import { cardIds, savedOrder } from "./helpers/timeline-board";
import { serveFixedTimeline } from "./helpers/fixed-daily";

// Drags a Timeline card under the sticky action bar in a common laptop window.
//
// In 1280x720 the five compact play cards fit above the sticky bar on load.
// Scrolling the page (GameAbout below the board) parks a lower card under the
// bar. The browser's drag autoscroll zone sits inside the bar. The bar takes
// no drop, so while a card is dragged the board hides it with visibility: the
// drop lands on the card under it, and the bar is back on drop and on dragend.
// When the bar comes back over the dropped card, the board scrolls that card
// into view above the bar; a card already in view leaves the page where it is.
//
// The list opts out of scroll anchoring, so a drop that follows a scroll
// leaves the card under the pointer instead of scrolling the page back by
// one card (135 px) and under the bar.

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const locales = [
  { id: "pt", path: "/pt-br/linha-do-tempo/" },
  { id: "en", path: "/en/timeline/" },
] as const;

const LAST = 4;
const STEP_PX = 8;
const WHEEL_NOTCH_PX = 120;
/** Kept clear of the bottom edge so Chromium does not autoscroll while the pointer rests. */
const AUTOSCROLL_CLEARANCE_PX = 40;
/** Rounding slack: the scroll margin above the bar is the bar height rounded up. */
const EPSILON_PX = 1;
/** A card that sits above the bar in 1280x720 with the board at the top. */
const IN_VIEW_TARGET = 1;

test.use({ viewport: { width: 1280, height: 720 } });

interface Rect {
  top: number;
  bottom: number;
}

function barRect(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const { top, bottom } = document.querySelector(".timeline-controls")!.getBoundingClientRect();
    return { top, bottom };
  });
}

function barVisibility(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector(".timeline-controls")!).visibility);
}

function cardRect(page: Page, index: number): Promise<Rect> {
  return page.evaluate((index) => {
    const { top, bottom } = document.querySelectorAll(".timeline-card")[index]!.getBoundingClientRect();
    return { top, bottom };
  }, index);
}

/**
 * The card that covers most of the band the bar takes, clear of the autoscroll
 * zone, and the y of that overlap's middle. Measured from layout, not from a
 * hit test, so the bar on top does not hide it.
 */
function cardUnderBar(page: Page): Promise<{ index: number; y: number } | null> {
  return page.evaluate((clearance) => {
    const bar = document.querySelector(".timeline-controls")!.getBoundingClientRect();
    const floor = Math.min(bar.bottom, innerHeight - clearance);
    const cards = [...document.querySelectorAll(".timeline-card")];
    let best: { index: number; y: number } | null = null;
    let bestSize = 0;
    for (const [index, card] of cards.entries()) {
      const box = card.getBoundingClientRect();
      const top = Math.max(box.top, bar.top);
      const bottom = Math.min(box.bottom, floor);
      if (bottom - top <= bestSize) continue;
      best = { index, y: (top + bottom) / 2 };
      bestSize = bottom - top;
    }
    return best;
  }, AUTOSCROLL_CLEARANCE_PX);
}

/** The order expected after moving the card at `from` to `to`. */
function moved(order: readonly string[], from: number, to: number): string[] {
  const next = [...order];
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card!);
  return next;
}

async function openBoard(page: Page, _baseURL: string, path: string): Promise<string[]> {
  await serveFixedTimeline(page);
  await page.goto(`${base}${path}`);
  await expectBoardDirectReady(page);
  const opening = await cardIds(page);
  expect(opening).toHaveLength(LAST + 1);
  expect(await savedOrder(page)).toBeNull();
  expect(await barVisibility(page)).toBe("visible");
  return opening;
}

/** Press on a card's title and move past the drag threshold; returns the pointer. */
async function startDrag(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(".timeline-card").nth(index).locator(".timeline-card-title").boundingBox();
  expect(box, `card ${index + 1} has a box`).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + STEP_PX, y + STEP_PX, { steps: 4 });
  return { x: x + STEP_PX, y: y + STEP_PX };
}

for (const locale of locales) {
  // Compact cards clear the bar in 1280x720; a shorter window brings a lower
  // card back under the sticky band so the drop-through-bar path stays covered.
  test.describe(`under-bar drop ${locale.id}`, () => {
    test.use({ viewport: { width: 1280, height: 480 } });

    test(`timeline drops a card on the band the action bar covers (${locale.id})`, async ({ page, baseURL }) => {
      const opening = await openBoard(page, baseURL!, locale.path);
      const scrollBefore = await page.evaluate(() => window.scrollY);

      const target = await cardUnderBar(page);
      expect(target, "a card sits under the bar").not.toBeNull();
      expect(target!.index, "the card under the bar is not the dragged one").toBeGreaterThan(0);

      const pointer = await startDrag(page, 0);
      await page.mouse.move(pointer.x, target!.y, { steps: 20 });
      expect(await page.evaluate(() => window.scrollY), "the page did not scroll").toBe(scrollBefore);
      await page.mouse.up();

      const expected = moved(opening, 0, target!.index);
      await expect.poll(() => cardIds(page)).toEqual(expected);
      await settleEffects(page);
      expect(await savedOrder(page)).toEqual(expected);
      expect(await barVisibility(page), "the bar is back after the drop").toBe("visible");
      const dropped = await cardRect(page, target!.index);
      expect(dropped.bottom, "the dropped card sits above the bar").toBeLessThanOrEqual((await barRect(page)).top + EPSILON_PX);
      expect(dropped.top, "the dropped card is in view").toBeGreaterThanOrEqual(0);
    });
  });

  test(`timeline leaves the page where it is after a drop between cards in view (${locale.id})`, async ({ page, baseURL }) => {
    const opening = await openBoard(page, baseURL!, locale.path);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const target = await cardRect(page, IN_VIEW_TARGET);
    expect(target.bottom, "the target card is in view above the bar").toBeLessThan((await barRect(page)).top);

    const pointer = await startDrag(page, 0);
    await page.mouse.move(pointer.x, (target.top + target.bottom) / 2, { steps: 20 });
    await page.mouse.up();

    const expected = moved(opening, 0, IN_VIEW_TARGET);
    await expect.poll(() => cardIds(page)).toEqual(expected);
    await settleEffects(page);
    expect(await savedOrder(page)).toEqual(expected);
    expect(await page.evaluate(() => window.scrollY), "the page did not scroll").toBe(scrollBefore);
  });

  // One notch leaves the first card's bottom edge in view and two take it out.
  // After one, Chromium moved the page back and left the dropped card under the
  // bar; Firefox did not move. After two, both moved the page back by a card.
  for (const notches of [1, 2]) {
    test(`timeline keeps the card dropped after a ${notches}-notch scroll above the action bar and under the pointer (${locale.id})`, async ({ page, baseURL }) => {
      const opening = await openBoard(page, baseURL!, locale.path);
      await page.locator(".timeline-card").first().evaluate((card) => card.scrollIntoView({ block: "start" }));
      const scrollBefore = await page.evaluate(() => window.scrollY);

      const pointer = await startDrag(page, 0);
      await page.mouse.wheel(0, WHEEL_NOTCH_PX * notches);
      // A move after the wheel delivers a dragover at the scrolled position.
      await page.mouse.move(pointer.x, pointer.y);
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: "the wheel scrolled the page" }).toBeGreaterThan(scrollBefore);

      const last = await cardRect(page, LAST);
      const dropAt = (last.top + last.bottom) / 2;
      expect(dropAt, "the last card is in reach after the wheel").toBeLessThan((await barRect(page)).top);
      await page.mouse.move(pointer.x, dropAt, { steps: 20 });
      await page.mouse.up();

      const expected = moved(opening, 0, LAST);
      await expect.poll(() => cardIds(page)).toEqual(expected);
      await settleEffects(page);
      expect(await barVisibility(page)).toBe("visible");
      const dropped = await cardRect(page, LAST);
      expect(dropped.bottom, "the dropped card sits above the bar").toBeLessThanOrEqual((await barRect(page)).top);
      expect(dropped.top, "the dropped card stays under the pointer").toBeLessThan(dropAt);
      expect(dropped.bottom, "the dropped card stays under the pointer").toBeGreaterThan(dropAt);
    });
  }

  test(`timeline shows the action bar again after a drag released off the board (${locale.id})`, async ({ page, baseURL }) => {
    const opening = await openBoard(page, baseURL!, locale.path);

    const pointer = await startDrag(page, 0);
    expect(await barVisibility(page), "the bar hides during the drag").toBe("hidden");
    // The page heading takes no drop, so the browser ends the drag with dragend alone.
    const heading = await page.locator("h1").first().boundingBox();
    expect(heading, "the heading has a box").not.toBeNull();
    await page.mouse.move(pointer.x, heading!.y + heading!.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect.poll(() => barVisibility(page), { message: "the bar is back after dragend" }).toBe("visible");
    expect(await cardIds(page)).toEqual(opening);
    await settleEffects(page);
    expect(await savedOrder(page)).toBeNull();
    await expect(page.getByRole("button", { name: locale.id === "pt" ? "Verificar ordem" : "Check order" })).toBeVisible();
  });
}
