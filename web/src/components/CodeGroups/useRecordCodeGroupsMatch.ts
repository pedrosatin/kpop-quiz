import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { dailyBoardRound, useRecordDailyMatch } from "../../lib/use-record-daily-match";

export function codeGroupsMatchId(puzzle: CodeGroupsPuzzle): string {
  return `code-${puzzle.puzzle_id}`;
}

/** Records the finished Code board once in player stats (see `useRecordDailyMatch`). */
export function useRecordCodeGroupsMatch(
  puzzle: CodeGroupsPuzzle,
  isFinished: boolean,
  isWin: boolean,
): void {
  useRecordDailyMatch("code", dailyBoardRound(puzzle, codeGroupsMatchId(puzzle)), isFinished, isWin);
}
