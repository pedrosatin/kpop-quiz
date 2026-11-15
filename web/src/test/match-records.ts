import { loadPlayerStats, type GameId } from "../lib/player-stats";

const MARKER_PREFIX = "kpop-match-recorded-";

/** Every `kpop-match-recorded-*` key in localStorage, sorted. */
export function matchMarkers(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith(MARKER_PREFIX)).sort();
}

/** Played and won counts of one game in the saved player stats. */
export function gameCounts(gameId: GameId): { played: number; won: number } {
  const { played, won } = loadPlayerStats().games[gameId];
  return { played, won };
}
