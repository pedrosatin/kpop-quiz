import { useEffect, useRef } from "preact/hooks";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import type { ConnectionsGameStatus } from "./types";

/** Records one finished match in player stats; ignores restored or restarted boards. */
export function useRecordConnectionsMatch(
  puzzle: ConnectionsPuzzle,
  gameStatus: ConnectionsGameStatus,
  isGameOver: boolean,
): void {
  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (isGameOver && puzzle) {
      const matchId = `connections-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("connections", matchId)) {
        const isWin = gameStatus === "won";
        recordGameFinish("connections", isWin, puzzle.reference_date || getTodayDateString());
        markGameMatchRecorded("connections", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (!isGameOver) {
      recordedMatchRef.current = null;
    }
  }, [isGameOver, gameStatus, puzzle]);
}
