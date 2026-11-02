import type { Page } from "@playwright/test";

/**
 * Preact runs `useEffect` after the next frame, or after 35 ms when no frame
 * arrives. Saving a game and recording its stats are effects, so they can land
 * after the new state is already in the DOM: a test that reads storage, or
 * reloads, right after the result appears races the write. Waiting longer than
 * that bound closes the window.
 */
const PREACT_EFFECT_BOUND_MS = 35;
const MARGIN_MS = 100;

declare global {
  interface Window {
    __effectFlushMs?: number;
  }
}

export async function settleEffects(page: Page): Promise<void> {
  await page.evaluate(
    ([bound, margin]) => new Promise<void>((resolve) => setTimeout(resolve, (window.__effectFlushMs ?? bound) + margin)),
    [PREACT_EFFECT_BOUND_MS, MARGIN_MS] as const,
  );
}

/** Reloads once the game's save effect has run, so the reload restores what the player just did. */
export async function reloadPersisted(page: Page): Promise<void> {
  await settleEffects(page);
  await page.reload();
}

/** Delays Preact's effect flush so the window between DOM update and write is wide and deterministic. */
export async function delayPassiveEffects(page: Page, ms = 400): Promise<void> {
  await page.addInitScript(([bound, delay]) => {
    window.__effectFlushMs = delay;
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, wait?: number, ...args: unknown[]) =>
      native(fn, wait === bound ? delay : wait, ...args)) as typeof window.setTimeout;
  }, [PREACT_EFFECT_BOUND_MS, ms] as const);
}
