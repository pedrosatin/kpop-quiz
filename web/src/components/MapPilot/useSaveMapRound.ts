import { useEffect } from "preact/hooks";
import type { MapPilotEvent } from "../../data/map-pilot";
import { storeMapPilotSave } from "./map-pilot-save";
import type { RoundState } from "./map-pilot-turn";

/**
 * Saves after every answer and every Next, so a reload resumes the date on
 * screen or the result. An untouched round is not saved, but a finished one
 * is, even with zero answers after a give-up. So is a replay, or a reload
 * would turn it back into the day's round.
 */
export function useSaveMapRound(game: RoundState, round: MapPilotEvent[], isComplete: boolean): void {
  useEffect(() => {
    if (round.length === 0 || (game.answers.length === 0 && !isComplete && !game.replay)) return;
    storeMapPilotSave(game.date, {
      events: round.map((event) => event.event_mbid),
      answers: game.answers,
      index: game.index,
      ...(game.gaveUp ? { gaveUp: true } : {}),
      ...(game.replay ? { replay: true } : {}),
    });
  }, [game, round]);
}
