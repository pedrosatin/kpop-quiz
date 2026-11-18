import type { BrowserContext, Page } from "@playwright/test";

/**
 * The game guards (a Next that ignores a click for 300 ms after the verdict,
 * a cell, a submit, a result button) measure time with `performance.now()`.
 * A test that has to get past one used to sleep in real time. With Playwright's
 * clock installed the page still sees time pass, but the test crosses the
 * guard by moving the page's clock, so the runner does not wait.
 *
 * The installed clock keeps running in real time, so animations, debounces,
 * fetches and polling `expect`s behave as before; only `crossGuard` jumps it.
 * A test that has no clock installed, such as the playthrough, still waits in
 * real time through the same call, which keeps the end-to-end path honest.
 */
const controlled = new WeakSet<BrowserContext>();

/** Installs the page clock. `time` starts it at another date (the tomorrow scenarios). */
export async function installGuardClock(page: Page, time?: number | Date): Promise<void> {
  await page.clock.install(time === undefined ? {} : { time });
  controlled.add(page.context());
}

/** Whether `installGuardClock` ran for this page's context. */
export function hasGuardClock(page: Page): boolean {
  return controlled.has(page.context());
}

/**
 * Lets `ms` pass for the page: a clock jump when the clock is installed, a real
 * wait otherwise. Callers pass the guard plus a margin, as they did before.
 */
export async function crossGuard(page: Page, ms: number): Promise<void> {
  if (hasGuardClock(page)) await page.clock.fastForward(ms);
  else await page.waitForTimeout(ms);
}
