import type { SeoRouteKey } from "../i18n/catalog";

/** First reference dates shipped in the published artifacts. See ADR 021 for history. */
export const FIRST_DAILY_DATE = {
  quiz: "2026-09-18", grid: "2026-09-17", connections: "2026-09-17",
  nameGuess: "2026-09-18", wordSearch: "2026-09-18", timeline: "2026-09-19",
  mapPilot: "2026-09-25", code: "2026-10-19", crossword: "2026-10-31",
} as const satisfies Record<SeoRouteKey, string>;

/** Calendar arithmetic on artifact dates, independent of the browser's zone and language. */
export function dailyChallengeNumber(game: SeoRouteKey, referenceDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
  const timestamp = Date.parse(`${referenceDate}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== referenceDate) return null;
  const days = (timestamp - Date.parse(`${FIRST_DAILY_DATE[game]}T00:00:00Z`)) / 86_400_000;
  return days >= 0 ? days + 1 : null;
}

export function dailyShareHeader(game: SeoRouteKey, name: string, referenceDate?: string | null): string {
  const number = referenceDate ? dailyChallengeNumber(game, referenceDate) : null;
  return `K-pop Quiz${number === null ? "" : ` #${number}`} · ${name}`;
}
