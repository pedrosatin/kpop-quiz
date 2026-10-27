import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";

/** Wait until StatsNavTrigger has hydrated so #stats-open-nav-btn onClick is attached. */
async function waitForStatsNavHydrated(page: Page) {
  const island = page.locator('astro-island[component-url*="StatsNavTrigger"]');
  await expect(island).toBeAttached();
  await expect(island).not.toHaveAttribute("ssr");
}

test("Escape closes the visible statistics dialog before passive effects run", async ({ page }) => {
  await page.goto("/pt-br/codigo/");
  await waitForStatsNavHydrated(page);
  const trigger = page.locator("#stats-open-nav-btn");
  await expect(trigger).toBeVisible();
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame;
    const timeout = window.setTimeout;
    const evidence = { heldFrames: 0, heldFallbacks: 0, trustedEscape: false };
    Object.assign(window, { __escapeEvidence: evidence });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") evidence.trustedEscape = event.isTrusted;
    }, { capture: true });
    window.requestAnimationFrame = () => { evidence.heldFrames++; return 0; };
    // Match StatsModal focus-install fallback (30ms).
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      delay === 30 ? (evidence.heldFallbacks++, 0) : timeout(handler, delay, ...args)) as typeof window.setTimeout;
    Object.assign(window, { __restoreScheduling: () => {
      window.requestAnimationFrame = raf;
      window.setTimeout = timeout;
    } });
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const close = page.locator(".stats-modal-card .modal-close");
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  const evidence = await page.evaluate(() => (window as unknown as { __escapeEvidence: { heldFrames: number; heldFallbacks: number; trustedEscape: boolean } }).__escapeEvidence);
  expect(evidence.heldFrames).toBeGreaterThan(0);
  expect(evidence.heldFallbacks).toBeGreaterThan(0);
  expect(evidence.trustedEscape).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.evaluate(() => (window as unknown as { __restoreScheduling: () => void }).__restoreScheduling());
});
