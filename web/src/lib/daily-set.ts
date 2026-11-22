import { getMessages } from "../i18n/catalog";
import type { SeoRouteKey } from "../i18n/catalog";
import { FIRST_DAILY_DATE } from "./daily-challenge";
import { completedDailyGames, DAILY_GAMES, statsGameId } from "./daily-progress";
import {
  loadPlayerStats,
  savePlayerStats,
  type GameId,
  type PlayerStats,
} from "./player-stats";
import type { Locale } from "./quiz-types";
import { seoAbsoluteUrl, seoRoute, seoShareCampaign } from "./seo-routes";

/** Earliest published daily board; the set's day number counts from here. */
export const SITE_FIRST_DAILY_DATE = FIRST_DAILY_DATE.grid;

const MAX_STORED_SET_DATES = 14;

/** Calendar day index of the set, same arithmetic as each game's `#N`. */
export function dailySetNumber(referenceDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
  const timestamp = Date.parse(`${referenceDate}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== referenceDate) {
    return null;
  }
  const days = (timestamp - Date.parse(`${SITE_FIRST_DAILY_DATE}T00:00:00Z`)) / 86_400_000;
  return days >= 0 ? days + 1 : null;
}

/** Daily games the day published (every `DAILY_GAMES` entry minus `omitted`). */
export function publishedDailyGames(
  omitted: ReadonlySet<SeoRouteKey> = new Set(),
): SeoRouteKey[] {
  return DAILY_GAMES.filter((key) => !omitted.has(key));
}

/** True when every published daily game of `date` is finished. */
export function isDailySetComplete(
  date: string,
  omitted: ReadonlySet<SeoRouteKey> = new Set(),
): boolean {
  const required = publishedDailyGames(omitted);
  if (required.length === 0) return false;
  const done = completedDailyGames(date, omitted);
  return required.every((key) => done.has(key));
}

/** Drop the trailing share URL line so the set can append a single link. */
export function stripShareUrl(text: string): string {
  const lines = text.replace(/\s+$/u, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (/^https?:\/\//u.test(last)) lines.pop();
  return lines.join("\n").replace(/\s+$/u, "");
}

function pruneDailySetLines(
  lines: NonNullable<PlayerStats["dailySetLines"]>,
  keepDate: string,
): NonNullable<PlayerStats["dailySetLines"]> {
  const dates = Object.keys(lines).sort();
  if (dates.length <= MAX_STORED_SET_DATES) return lines;
  const keep = new Set(dates.slice(-MAX_STORED_SET_DATES));
  keep.add(keepDate);
  const next: NonNullable<PlayerStats["dailySetLines"]> = {};
  for (const date of Object.keys(lines)) {
    if (keep.has(date) && lines[date]) next[date] = lines[date]!;
  }
  return next;
}

/**
 * Stores one game's share body (without URL) for the day's set summary.
 * Free play and empty bodies are ignored. A later rewrite of the same game
 * and date replaces the line (replay of the same board).
 */
export function rememberDailySetLine(date: string, gameId: GameId, shareText: string): void {
  const body = stripShareUrl(shareText).trim();
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const stats = loadPlayerStats();
  const byDate = { ...(stats.dailySetLines ?? {}) };
  const day = { ...(byDate[date] ?? {}) };
  day[gameId] = body;
  byDate[date] = day;
  stats.dailySetLines = pruneDailySetLines(byDate, date);
  savePlayerStats(stats);
}

/**
 * Increments the local set counter once when every published daily game of
 * `date` is done. Returns true the first time the date is recorded.
 *
 * Pass `confirmedComplete` when the caller already verified the set with the
 * current route included (DailyNext mounts before some saves flush).
 */
export function recordDailySetComplete(
  date: string,
  confirmedComplete = false,
  omitted: ReadonlySet<SeoRouteKey> = new Set(),
): boolean {
  if (!confirmedComplete && !isDailySetComplete(date, omitted)) return false;
  const stats = loadPlayerStats();
  if (stats.lastDailySetDate === date) return false;
  stats.dailySetsCompleted = (stats.dailySetsCompleted ?? 0) + 1;
  stats.lastDailySetDate = date;
  savePlayerStats(stats);
  return true;
}

/** Production home URL tagged for share attribution (ticket 04 short link). */
export function dailySetShareUrl(locale: Locale): string {
  const path = seoRoute("quiz", locale).path;
  const params = new URLSearchParams({ s: seoShareCampaign("quiz") });
  return `${seoAbsoluteUrl(path)}?${params}`;
}

/**
 * Day summary for share: set header, each published game's stored body in tab
 * order, one short link at the end. Omitted games are left out of the text.
 * Null when the set is incomplete or a published line is still missing.
 *
 * Pass `confirmedComplete` when the caller already verified the set with the
 * current route included (DailyNext mounts before some saves flush).
 */
export function buildDailySetShareText(
  date: string,
  locale: Locale,
  confirmedComplete = false,
  omitted: ReadonlySet<SeoRouteKey> = new Set(),
): string | null {
  if (!confirmedComplete && !isDailySetComplete(date, omitted)) return null;
  const lines = loadPlayerStats().dailySetLines?.[date] ?? {};
  const bodies: string[] = [];
  for (const key of publishedDailyGames(omitted)) {
    const body = lines[statsGameId(key)];
    if (!body) return null;
    bodies.push(body);
  }
  const number = dailySetNumber(date);
  const messages = getMessages(locale);
  const header = number === null
    ? messages.dailySetShareHeaderPlain
    : messages.dailySetShareHeader(number);
  return `${header}\n\n${bodies.join("\n\n")}\n${dailySetShareUrl(locale)}`;
}
