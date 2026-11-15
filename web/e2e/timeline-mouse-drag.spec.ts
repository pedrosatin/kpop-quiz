import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { skipUnlessPublished } from "./helpers/published";
import { settleEffects } from "./helpers/passive-effects";

// Drags a card with the mouse, the way a desktop player does, and checks the
// order on screen and the draft the board saves.
//
// The cards are pressed and released through `page.mouse` on visible points.
// `locator.dragTo()` hovers the target before the first move, which scrolls it
// into view. Chromium starts the HTML5 drag on that first move and hit-tests the
// press point in the scrolled page, so it drags whichever card sits there now,
// or none. Firefox keeps the pressed card. With the whole board in view,
// `dragTo` works in both, so the helper fails here and the game works.

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const DRAFT_KEY_PREFIX = "kpop-timeline-";

const locales = [
  { id: "pt", path: "/pt-br/linha-do-tempo/" },
  { id: "en", path: "/en/timeline/" },
] as const;

const moves = [
  { from: 0, to: 2 },
  { from: 2, to: 0 },
] as const;

function cardIds(page: Page): Promise<string[]> {
  return page
    .locator(".timeline-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-testid")!.replace("timeline-card-", "")));
}

/** The board order saved as the draft, or null before the first move. */
function savedOrder(page: Page): Promise<string[] | null> {
  return page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith(prefix));
    const saved = key ? localStorage.getItem(key) : null;
    return saved ? (JSON.parse(saved).orderedEventIds as string[]) : null;
  }, DRAFT_KEY_PREFIX);
}

/** The center of a card's title, asserted to sit inside the viewport so the mouse can reach it. */
async function cardPoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(".timeline-card").nth(index).locator(".timeline-card-title").boundingBox();
  expect(box, `card ${index} has a box`).not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const viewport = page.viewportSize()!;
  expect(point.y, `card ${index} is in view`).toBeGreaterThan(0);
  expect(point.y, `card ${index} is in view`).toBeLessThan(viewport.height);
  return point;
}

/** Press on one card, move in small steps past the drag threshold, and release on another. */
async function dragCardWithMouse(page: Page, from: number, to: number): Promise<void> {
  const start = await cardPoint(page, from);
  const end = await cardPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
}

for (const locale of locales) {
  for (const { from, to } of moves) {
    test(`timeline moves a card dragged with the mouse from ${from + 1} to ${to + 1} and saves the draft (${locale.id})`, async ({ page, baseURL }) => {
      await skipUnlessPublished(page, baseURL!, "timeline.daily.json");
      await page.goto(`${base}${locale.path}`);
      await expectBoardDirectReady(page);
      // The moves stay within the first three cards, which fit in the default
      // 720 px window, so the page does not scroll while the button is down.
      await page.locator(".timeline-card").first().evaluate((card) => card.scrollIntoView({ block: "start" }));

      const opening = await cardIds(page);
      expect(opening).toHaveLength(5);
      expect(await savedOrder(page)).toBeNull();

      await dragCardWithMouse(page, from, to);

      const expected = [...opening];
      const [moved] = expected.splice(from, 1);
      expected.splice(to, 0, moved!);
      await expect.poll(() => cardIds(page)).toEqual(expected);
      await settleEffects(page);
      expect(await savedOrder(page)).toEqual(expected);
    });
  }
}
