import { useEffect, useRef } from "preact/hooks";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { recordMatchOnce } from "../../lib/player-stats";

export function codeGroupsMatchId(puzzle: CodeGroupsPuzzle): string {
  return `code-${puzzle.puzzle_id}`;
}

/**
 * Records one finished match in player stats; ignores restored or restarted
 * boards. A finished game restored from storage is counted once, on the
 * first load that finds it uncounted.
 */
export function useRecordCodeGroupsMatch(
  puzzle: CodeGroupsPuzzle,
  isFinished: boolean,
  isWin: boolean,
): void {
  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (isFinished && puzzle) {
      const matchId = codeGroupsMatchId(puzzle);
      if (recordedMatchRef.current !== matchId) {
        recordMatchOnce("code", matchId, isWin, puzzle.reference_date);
        recordedMatchRef.current = matchId;
      }
    } else if (!isFinished) {
      recordedMatchRef.current = null;
    }
  }, [isFinished, isWin, puzzle]);
}
