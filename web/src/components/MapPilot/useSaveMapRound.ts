import { useEffect } from "preact/hooks";
import type { MapPilotEvent } from "../../data/map-pilot";
import { storeMapPilotSave } from "./map-pilot-save";
import { saveOfRound, shouldSaveRound } from "./map-pilot-progress";
import type { RoundState } from "./map-pilot-turn";

/**
 * Saves after every answer and every Next, so a reload resumes the date on
 * screen or the result. `shouldSaveRound` tells which rounds are saved.
 */
export function useSaveMapRound(game: RoundState, round: MapPilotEvent[], isComplete: boolean): void {
  useEffect(() => {
    if (shouldSaveRound(game, round, isComplete)) storeMapPilotSave(game.date, saveOfRound(game, round));
  }, [game, round]);
}
