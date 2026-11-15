import { useEffect, useRef } from "preact/hooks";
import { dailyReferenceDate, staleDailyDate } from "../data/daily-artifact";
import { recordMatchOnce, type GameId } from "./player-stats";

/** A daily round as a game reports it to `useRecordDailyMatch`. */
export interface DailyRound {
  /**
   * The game's own id for the round (`code-<puzzle_id>`, `map-<date>`). A
   * match counted under this id before ADR 030 is not counted again.
   */
  matchId: string;
  /** The challenge's day. The daily match counts once per game and date. */
  date: string;
}

/**
 * The round on a daily board; a board with no date counts for today. Null for
 * a board the loader served after its day (`staleDailyDate`). That board is
 * not today's challenge and counts nothing.
 */
export function dailyBoardRound(board: { reference_date: string }, matchId: string): DailyRound | null {
  if (staleDailyDate(board)) return null;
  return { matchId, date: board.reference_date || dailyReferenceDate() };
}

/**
 * Records one finished daily round in player stats, once per game and date
 * (ADR 030). A finished game restored from storage counts on the first load
 * that finds it uncounted; a restarted board finished again, or another
 * board for the same date, counts nothing. `round` is null while there is
 * nothing to count: no board yet, a stale board or a replay.
 */
export function useRecordDailyMatch(gameId: GameId, round: DailyRound | null, finished: boolean, won: boolean): void {
  const recordedMatchRef = useRef<string | null>(null);
  // Primitives, so a round rebuilt on each render does not rerun the effect.
  const matchId = round?.matchId ?? null;
  const date = round?.date;

  useEffect(() => {
    if (finished && matchId !== null) {
      if (recordedMatchRef.current !== matchId) {
        recordMatchOnce(gameId, matchId, won, date);
        recordedMatchRef.current = matchId;
      }
    } else if (!finished) {
      recordedMatchRef.current = null;
    }
  }, [gameId, matchId, date, finished, won]);
}
