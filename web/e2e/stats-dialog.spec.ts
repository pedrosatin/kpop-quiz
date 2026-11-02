import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

/** Wait until StatsNavTrigger has hydrated so #stats-open-nav-btn onClick is attached. */
async function waitForStatsNavHydrated(page: Page) {
  const island = page.locator('astro-island[component-url*="StatsNavTrigger"]');
  await expect(island).toBeAttached();
  await expect(island).not.toHaveAttribute("ssr");
}

for (const [locale, path] of [
  ["pt", "/pt-br/codigo/"],
  ["en", "/en/code/"],
  ["pt", "/pt-br/conexoes/"],
  ["en", "/en/crossword/"],
] as const) {
  test(`${locale} ${path}: statistics keyboard and close controls`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${base}${path}`);
    await waitForStatsNavHydrated(page);
    const trigger = page.locator("#stats-open-nav-btn");
    const dialog = page.getByRole("dialog");
    const close = page.locator(".stats-modal-card .modal-close");
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    const last = dialog.getByRole("button").last();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.locator(".modal-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
