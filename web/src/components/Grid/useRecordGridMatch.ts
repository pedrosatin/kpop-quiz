import { useEffect, useRef } from "preact/hooks";
import type { IntersectionGrid } from "../../lib/quiz-types";
import {
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import { dailyReferenceDate } from "../../data/daily-artifact";
import type { GridGameStatus } from "./types";

export function gridMatchId(grid: IntersectionGrid): string {
  return `grid-${grid.reference_date || grid.grid_id}`;
}

export function isGridWin(solvedCount: number): boolean {
  return solvedCount >= 5;
}

/** Records one finished match in player stats; ignores restored or restarted boards. */
export function useRecordGridMatch(
  grid: IntersectionGrid | null,
  status: GridGameStatus,
  solvedCount: number,
): void {
  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === "complete" && grid) {
      const matchId = gridMatchId(grid);
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("grid", matchId)) {
        const isWin = isGridWin(solvedCount);
        recordGameFinish("grid", isWin, grid.reference_date || dailyReferenceDate());
        markGameMatchRecorded("grid", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (status !== "complete") {
      recordedMatchRef.current = null;
    }
  }, [status, grid, solvedCount]);
}
