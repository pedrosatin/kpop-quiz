import { useEffect, useRef } from "preact/hooks";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import {
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";

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
      const matchId = `code-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("code", matchId)) {
        recordGameFinish("code", isWin, puzzle.reference_date);
        markGameMatchRecorded("code", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (!isFinished) {
      recordedMatchRef.current = null;
    }
  }, [isFinished, isWin, puzzle]);
}
