import { test as base, expect, type Page } from "@playwright/test";
import { CONSENT_BUILD, SITE_BUILD_FIXTURE_TIMEOUT_MS, serveSiteBuild } from "./fixtures/site-builds";
import { serveFixedGrid } from "./helpers/fixed-daily";
import { LOCAL_BUILD_TAG } from "./target";

// Serve the real consent island independently of production secrets or BASE_URL.
const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => serveSiteBuild(CONSENT_BUILD, use), { scope: "worker", timeout: SITE_BUILD_FIXTURE_TIMEOUT_MS }],
});

test.use({ serviceWorkers: "block" });

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
      test(`grid ${locale.id} ${viewport.width}x${viewport.height} banner ${consent}: bar fits the screen`, { tag: LOCAL_BUILD_TAG }, async ({ page, context, consentURL }) => {
        await page.setViewportSize(viewport);
        await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL
          ? route.continue()
          : route.abort());
        // Frozen board via the shared helper; the consent build's baked data/ is ignored.
        await serveFixedGrid(page, { guardClock: false });
        await page.goto(consentURL + locale.path);
        const banner = page.locator(".consent-banner");
        await expect(banner, "the consent build must render the real banner").toBeVisible();
        const bar = page.locator(".grid-actions");
        await expect(bar).toBeVisible();
        if (consent === "rejected") {
          await banner.getByRole("button", { name: locale.reject }).click();
          await expect(banner).toHaveCount(0);
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

        // Giving up still works from the bar after confirmation; the finished bar fits too.
        await giveUp.click();
        await page.getByRole("button", { name: locale.id === "pt" ? "Sim, desistir" : "Yes, give up" }).click();
        await expect(page.locator(".grid-result")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        if (consent === "open") await expect(banner).toBeVisible();
        await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem("kpop-quiz-consent")))
          .toBe(consent === "rejected" ? "rejected" : null);
      });
    }
