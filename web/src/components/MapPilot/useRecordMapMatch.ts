import { useRecordDailyMatch } from "../../lib/use-record-daily-match";

export function mapMatchId(roundDate: string): string {
  return `map-${roundDate}`;
}

/**
 * Counts the finished daily round once in the player stats. A round marked as
 * replay (an older save) is free play and is not counted.
 */
export function useRecordMapMatch(roundDate: string, isComplete: boolean, isWin: boolean, isReplay: boolean): void {
  const round = isReplay ? null : { matchId: mapMatchId(roundDate), date: roundDate };
  useRecordDailyMatch("map", round, isComplete, isWin);
}
