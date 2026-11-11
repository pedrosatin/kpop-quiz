import { vi } from "vitest";
import { setGameAnalyticsConsent } from "../lib/game-analytics";

/** The calendar day after `date` (YYYY-MM-DD). */
export function dayAfter(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Sets the clock to the afternoon of `date` in Sao Paulo; undo with vi.useRealTimers(). */
export function onDay(date: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
}

/** Serves `board` as the main daily artifact, parsed afresh on each load; data/next/ has none. */
export function serveDailyBoard(board: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("/data/next/") ? new Response(null, { status: 404 }) : new Response(JSON.stringify(board))));
}

/**
 * Measures with consent and returns the `daily` parameter of every game event
 * sent so far. Undo with setGameAnalyticsConsent("", false) and vi.unstubAllGlobals().
 */
export function trackDailyParam(): () => unknown[] {
  const gtag = vi.fn();
  vi.stubGlobal("gtag", gtag);
  setGameAnalyticsConsent("G-TEST", true);
  return () => gtag.mock.calls.map((call) => (call[2] as { daily?: string }).daily);
}

export function resetStaleDaily(): void {
  setGameAnalyticsConsent("", false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
}
