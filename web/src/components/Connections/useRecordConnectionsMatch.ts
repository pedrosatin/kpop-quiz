import { useEffect, useRef } from "preact/hooks";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { recordDailyBoardMatch } from "../../lib/player-stats";
import type { ConnectionsGameStatus } from "./types";

export function connectionsMatchId(puzzle: ConnectionsPuzzle): string {
  return `connections-${puzzle.puzzle_id}`;
}

/** Records one finished match in player stats; ignores restored or restarted boards. */
export function useRecordConnectionsMatch(
  puzzle: ConnectionsPuzzle,
  gameStatus: ConnectionsGameStatus,
  isGameOver: boolean,
): void {
  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (isGameOver && puzzle) {
      const matchId = connectionsMatchId(puzzle);
      if (recordedMatchRef.current !== matchId) {
        const isWin = gameStatus === "won";
        recordDailyBoardMatch("connections", puzzle, matchId, isWin);
        recordedMatchRef.current = matchId;
      }
    } else if (!isGameOver) {
      recordedMatchRef.current = null;
    }
  }, [isGameOver, gameStatus, puzzle]);
}
