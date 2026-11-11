import { useEffect } from "preact/hooks";
import { recordMatchOnce } from "../../lib/player-stats";

export function mapMatchId(roundDate: string): string {
  return `map-${roundDate}`;
}

/**
 * Counts the finished daily round once in the player stats. A round marked as
 * replay (an older save) is free play and is not counted.
 */
export function useRecordMapMatch(roundDate: string, isComplete: boolean, isWin: boolean, isReplay: boolean): void {
  useEffect(() => {
    if (isComplete && !isReplay) recordMatchOnce("map", mapMatchId(roundDate), isWin, roundDate);
  }, [roundDate, isComplete, isWin, isReplay]);
}
