import type { SeoRouteKey } from "../i18n/catalog";
import { isMapPilotRoundFinished } from "../components/MapPilot/map-pilot-save";
import { loadPlayerStats, type GameId } from "./player-stats";
import type { Locale } from "./quiz-types";
import { SEO_ROUTES, seoRoute } from "./seo-routes";

/** The daily games in the order of the navigation tabs. */
export const DAILY_GAMES: readonly SeoRouteKey[] = SEO_ROUTES.filter((route) => route.locale === "pt-BR").map((route) => route.key);

/** Fired with the game key when a daily result shows, so the tabs mark it. */
export const DAILY_DONE_EVENT = "kpop-daily-done";

const STATS_ID: Record<Exclude<SeoRouteKey, "mapPilot">, GameId> = {
  quiz: "quiz",
  grid: "grid",
  connections: "connections",
  nameGuess: "name-guess",
  wordSearch: "word-search",
  timeline: "timeline",
  code: "code",
  crossword: "crossword",
};

/**
 * Daily games finished on `today`. Stats keep the date of the last daily
 * match of each game (win or loss). The map reads its save of the day
 * instead, which shows the result before the stats write and on a replay.
 */
export function completedDailyGames(today: string): Set<SeoRouteKey> {
  const { games } = loadPlayerStats();
  return new Set(
    DAILY_GAMES.filter((key) =>
      key === "mapPilot" ? isMapPilotRoundFinished(today) : games[STATS_ID[key]]?.lastPlayedDate === today,
    ),
  );
}

/** First game in tab order, other than `current`, not finished today; null when none is left. */
export function nextDailyGame(current: SeoRouteKey, done: ReadonlySet<SeoRouteKey>): SeoRouteKey | null {
  return DAILY_GAMES.find((key) => key !== current && !done.has(key)) ?? null;
}

/** Site path of a game's daily challenge; the quiz tab opens free play, so its link asks for the daily theme. */
export function dailyGamePath(key: SeoRouteKey, locale: Locale): string {
  const { path } = seoRoute(key, locale);
  return key === "quiz" ? `${path}?theme=daily` : path;
}

/** HH:MM:SS of a countdown in seconds. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
