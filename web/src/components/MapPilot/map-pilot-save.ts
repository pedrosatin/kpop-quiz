import { getLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";

/**
 * What localStorage keeps of one daily round, under `kpop-map-<YYYY-MM-DD>`
 * (the round date):
 * `{ events: string[], answers: string[], index: number, replay?: true, gaveUp?: true }`.
 * `events` are the MusicBrainz event MBIDs of the round in order, so a save
 * made before a data refresh changed the round is dropped. `answers` are
 * the map feature ids the player picked, one per answered date, in order.
 * `index` is the date on screen (0-based); it equals the number of dates
 * the player moved past, and `index === events.length` means the result is
 * showing. `answers` has `index` entries, or `index + 1` while the date on
 * screen is answered and Next was not pressed yet. A give-up jumps to the
 * result, so a finished round may hold fewer answers than dates. `replay`
 * marks a round started with Play again, which analytics counts as free play;
 * the result no longer offers Play again, but older saves may keep the mark.
 * The game reads and checks a save in map-pilot-progress.ts.
 */
export interface MapPilotSave {
  events: string[];
  answers: string[];
  index: number;
  replay?: boolean;
  gaveUp?: boolean;
}

export function mapPilotStorageKey(roundDate: string): string {
  return `kpop-map-${roundDate}`;
}

/** Whether the save of this round shows its result; the pilot keeps no stats. */
export function isMapPilotRoundFinished(roundDate: string): boolean {
  try {
    const saved = JSON.parse(getLocalStorageItem(mapPilotStorageKey(roundDate)) ?? "null") as Partial<MapPilotSave> | null;
    return Array.isArray(saved?.events) && saved.events.length > 0 && saved.index === saved.events.length;
  } catch {
    return false;
  }
}

export function storeMapPilotSave(roundDate: string, save: MapPilotSave): void {
  setLocalStorageItem(mapPilotStorageKey(roundDate), JSON.stringify(save));
}
