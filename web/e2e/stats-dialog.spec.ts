import { expect, test } from "@playwright/test";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";
for (const [locale, path, reject] of [
  ["pt", "/pt-br/codigo/", "Recusar Google Analytics"],
  ["en", "/en/code/", "Reject Google Analytics"],
  ["pt", "/pt-br/conexoes/", "Recusar Google Analytics"],
  ["en", "/en/crossword/", "Reject Google Analytics"],
] as const) {
  test(`${locale} ${path}: statistics keyboard and close controls`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${base}${path}`);
    const rejectButton = page.getByRole("button", { name: reject });
    if (await rejectButton.isVisible()) await rejectButton.click();
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
