import { test, expect, type Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";

const prefix = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const locales = [
  { id: "pt", path: "/pt-br/grid/", hint: /Escolha uma casa/, giveUp: "Desistir", reject: /^Recusar Google Analytics$/ },
  { id: "en", path: "/en/grid/", hint: /Pick a square/, giveUp: "Give up", reject: /^Reject Google Analytics$/ },
] as const;
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

for (const locale of locales)
  for (const viewport of viewports)
    for (const consent of ["open", "rejected"] as const) {
      test(`grid ${locale.id} ${viewport.width}x${viewport.height} banner ${consent}: bar fits the screen`, async ({ page, baseURL }) => {
        await page.setViewportSize(viewport);
        await page.goto(joinBaseUrl(baseURL!, prefix + locale.path));
        const bar = page.locator(".grid-actions");
        await expect(bar).toBeVisible();
        if (consent === "rejected") {
          await page.locator(".consent-banner").getByRole("button", { name: locale.reject }).click();
          await expect(page.locator(".consent-banner")).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);

        // The hint keeps real width and shows its whole line.
        const hint = bar.getByRole("status");
        await expect(hint).toContainText(locale.hint);
        const hintBox = (await hint.boundingBox())!;
        expect(hintBox.width).toBeGreaterThan(viewport.width / 2);

        // Progress and the button sit inside the screen; the button is what a tap hits.
        const giveUp = bar.getByRole("button", { name: locale.giveUp });
        await expect(giveUp).toBeInViewport({ ratio: 1 });
        const box = (await giveUp.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        const progress = (await bar.locator(".grid-progress").boundingBox())!;
        expect(progress.x + progress.width).toBeLessThanOrEqual(box.x);
        const hit = await giveUp.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top === el || el.contains(top);
        });
        expect(hit).toBe(true);

        // Giving up still works from the bar and the finished bar fits too.
        await giveUp.click();
        await expect(page.locator(".grid-result")).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
