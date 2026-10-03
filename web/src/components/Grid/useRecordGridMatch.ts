import { useEffect, useRef } from "preact/hooks";
import type { IntersectionGrid } from "../../lib/quiz-types";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import type { GridGameStatus } from "./types";

/** Records one finished match in player stats; ignores restored or restarted boards. */
export function useRecordGridMatch(
  grid: IntersectionGrid | null,
  status: GridGameStatus,
  solvedCount: number,
): void {
  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === "complete" && grid) {
      const matchId = `grid-${grid.reference_date || grid.grid_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("grid", matchId)) {
        const isWin = solvedCount >= 5;
        recordGameFinish("grid", isWin, grid.reference_date || getTodayDateString());
        markGameMatchRecorded("grid", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (status !== "complete") {
      recordedMatchRef.current = null;
    }
  }, [status, grid, solvedCount]);
}
