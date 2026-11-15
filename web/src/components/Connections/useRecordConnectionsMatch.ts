import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { dailyBoardRound, useRecordDailyMatch } from "../../lib/use-record-daily-match";
import type { ConnectionsGameStatus } from "./types";

export function connectionsMatchId(puzzle: ConnectionsPuzzle): string {
  return `connections-${puzzle.puzzle_id}`;
}

/** Records the finished Connections board once in player stats (see `useRecordDailyMatch`). */
export function useRecordConnectionsMatch(
  puzzle: ConnectionsPuzzle,
  gameStatus: ConnectionsGameStatus,
  isGameOver: boolean,
): void {
  const round = dailyBoardRound(puzzle, connectionsMatchId(puzzle));
  useRecordDailyMatch("connections", round, isGameOver, gameStatus === "won");
}
