import type { SeoRouteKey } from "../i18n/catalog";
import { hasExactKeys, isIsoDate, isNonEmptyString, isRecord } from "../lib/guards";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  nextDataUrl,
} from "./daily-artifact";

export const DAILY_SET_FILENAME = "daily-set.json";
export const DAILY_SET_VERSION = "kpop-daily-set-v1";

/** Python `daily_set.GAMES` → web `SeoRouteKey` (map has no daily artifact). */
export const DAILY_SET_GAME_TO_ROUTE = {
  quiz: "quiz",
  grid: "grid",
  connections: "connections",
  "name-guess": "nameGuess",
  "word-search": "wordSearch",
  timeline: "timeline",
  "code-groups": "code",
  crossword: "crossword",
  strands: "strands",
} as const satisfies Record<string, SeoRouteKey>;

export type DailySetGameId = keyof typeof DAILY_SET_GAME_TO_ROUTE;

export type DailySetRecord = {
  schema_version: typeof DAILY_SET_VERSION;
  reference_date: string;
  omitted: Readonly<Record<string, string>>;
};

/** Games the day left out; empty means every `DAILY_GAMES` entry is required. */
export type DailySetRequirement = {
  omitted: ReadonlySet<SeoRouteKey>;
};

export const REQUIRE_ALL_DAILY_GAMES: DailySetRequirement = Object.freeze({
  omitted: Object.freeze(new Set<SeoRouteKey>()),
});

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

function isPublicReason(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const flat = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : char;
  }).join("").split(/\s+/u).filter(Boolean).join(" ");
  return value === flat;
}

/** True when `value` matches `kpop-daily-set-v1` (exact keys, known games). */
export function isDailySetRecord(value: unknown): value is DailySetRecord {
  if (!isRecord(value) || !hasExactKeys(value, ["schema_version", "reference_date", "omitted"])) {
    return false;
  }
  if (value.schema_version !== DAILY_SET_VERSION || !isIsoDate(value.reference_date)) {
    return false;
  }
  if (!isRecord(value.omitted)) return false;
  const games = Object.keys(DAILY_SET_GAME_TO_ROUTE);
  const omittedKeys = Object.keys(value.omitted);
  if (omittedKeys.length === games.length) return false;
  for (const [game, reason] of Object.entries(value.omitted)) {
    if (!(game in DAILY_SET_GAME_TO_ROUTE) || !isPublicReason(reason)) return false;
  }
  return true;
}

function requirementFrom(record: DailySetRecord): DailySetRequirement {
  const omitted = new Set<SeoRouteKey>();
  for (const game of Object.keys(record.omitted)) {
    omitted.add(DAILY_SET_GAME_TO_ROUTE[game as DailySetGameId]);
  }
  return { omitted };
}

async function readDailySetUrl(url: string): Promise<DailySetRecord | "missing" | "invalid"> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return "invalid";
  }
  if (isMissingDailyResponse(response)) return "missing";
  if (!response.ok) return "invalid";
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return "invalid";
  }
  return isDailySetRecord(payload) ? payload : "invalid";
}

/**
 * Loads today's `daily-set.json`. Prefers `data/`; uses `data/next/` only when
 * that copy's `reference_date` is today in America/Sao_Paulo. Any absence,
 * network error, unknown game, extra field, or date other than today yields
 * {@link REQUIRE_ALL_DAILY_GAMES}.
 */
export async function loadDailySetRequirement(
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<DailySetRequirement> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const main = await readDailySetUrl(dataUrl(DAILY_SET_FILENAME, effectiveBaseUrl));
  if (main !== "missing" && main !== "invalid" && main.reference_date === today) {
    return requirementFrom(main);
  }
  if (main !== "missing" && main !== "invalid" && main.reference_date > today) {
    return REQUIRE_ALL_DAILY_GAMES;
  }
  const next = await readDailySetUrl(nextDataUrl(DAILY_SET_FILENAME, effectiveBaseUrl));
  if (next !== "missing" && next !== "invalid" && next.reference_date === today) {
    return requirementFrom(next);
  }
  return REQUIRE_ALL_DAILY_GAMES;
}
