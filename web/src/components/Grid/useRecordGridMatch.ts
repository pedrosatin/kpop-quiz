import type { IntersectionGrid } from "../../lib/quiz-types";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { useRecordDailyMatch } from "../../lib/use-record-daily-match";
import type { GridGameStatus } from "./types";

export function gridMatchId(grid: IntersectionGrid): string {
  return `grid-${grid.reference_date || grid.grid_id}`;
}

export function isGridWin(solvedCount: number): boolean {
  return solvedCount >= 5;
}

/**
 * Records the finished grid once in player stats (see `useRecordDailyMatch`).
 * The grid loader never notes a board as stale, so the round skips that check.
 */
export function useRecordGridMatch(
  grid: IntersectionGrid | null,
  status: GridGameStatus,
  solvedCount: number,
  gaveUp = false,
): void {
  const round = grid ? { matchId: gridMatchId(grid), date: grid.reference_date || dailyReferenceDate() } : null;
  useRecordDailyMatch("grid", round, status === "complete", !gaveUp && isGridWin(solvedCount));
}
