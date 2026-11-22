import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { serveFixedTimeline } from "./helpers/fixed-daily";


const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
const PATH = "/pt-br/linha-do-tempo/";

const EPSILON_PX = 1;

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
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

async function openBoard(page: Page): Promise<void> {
  await serveFixedTimeline(page);
  await page.goto(`${base}${PATH}`);
  await expectBoardDirectReady(page);
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test(`timeline keeps every play card above the action bar on load (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await openBoard(page);

      const bar = await rectOf(page, ".timeline-controls");
      const cards = page.locator(".timeline-card");
      await expect(cards).toHaveCount(5);

      const lastBottom = await cards.last().evaluate((el) => el.getBoundingClientRect().bottom);
      const firstTop = await cards.first().evaluate((el) => el.getBoundingClientRect().top);

      test.info().annotations.push({
        type: "measure",
        description: `bar.top=${bar.top}; first.top=${firstTop}; last.bottom=${lastBottom}; scrollY=${await page.evaluate(() => scrollY)}`,
      });

      expect(firstTop, "the first card starts in view").toBeGreaterThanOrEqual(-EPSILON_PX);
      expect(lastBottom, "the last card sits above the action bar").toBeLessThanOrEqual(bar.top + EPSILON_PX);

      for (let i = 0; i < 5; i++) {
        const bottom = await cards.nth(i).evaluate((el) => el.getBoundingClientRect().bottom);
        expect(bottom, `card ${i + 1} sits above the action bar`).toBeLessThanOrEqual(bar.top + EPSILON_PX);
      }

      const moveBtn = page.locator(".timeline-btn").first();
      const btnBox = await moveBtn.boundingBox();
      expect(btnBox, "move controls stay on screen").not.toBeNull();
      expect(btnBox!.height, "touch target height stays at least 44px").toBeGreaterThanOrEqual(44);
      expect(btnBox!.width, "touch target width stays at least 44px").toBeGreaterThanOrEqual(44);
    });
  });
}
