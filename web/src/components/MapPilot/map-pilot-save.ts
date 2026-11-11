import type { MapPilotEvent } from "../../data/map-pilot";

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

const ROUND_KEY = /^kpop-map-\d{4}-\d{2}-\d{2}$/;

/** Removes the saves of other days, so old rounds do not pile up in storage. */
function pruneMapPilotSaves(roundDate: string): void {
  try {
    const keep = mapPilotStorageKey(roundDate);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key !== keep && ROUND_KEY.test(key)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {}
}

/**
 * Reads the save of this round and removes the saves of other days. A save for other events, with a feature
 * outside the playable countries, or with a count that play cannot reach
 * is dropped, so a stale or edited save never shows a round the player did
 * not play.
 */
export function loadMapPilotSave(
  roundDate: string,
  round: readonly MapPilotEvent[],
  playableFeatures: ReadonlySet<string>,
): MapPilotSave | null {
  pruneMapPilotSaves(roundDate);
  let saved: unknown;
  try {
    const raw = localStorage.getItem(mapPilotStorageKey(roundDate));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
  const { events, answers, index, replay, gaveUp } = saved as Partial<MapPilotSave>;
  if (!Array.isArray(events) || events.length !== round.length) return null;
  if (events.some((id, i) => id !== round[i]!.event_mbid)) return null;
  if (!Array.isArray(answers) || answers.some((id) => typeof id !== "string" || !playableFeatures.has(id))) return null;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > round.length) return null;
  if (gaveUp !== undefined && typeof gaveUp !== "boolean") return null;
  if (gaveUp === true && index !== round.length) return null;
  const count = answers.length;
  const valid: MapPilotSave = {
    events: [...events],
    answers: [...answers],
    index: index as number,
    ...(gaveUp === true ? { gaveUp: true } : {}),
    ...(replay === true ? { replay: true } : {}),
  };
  if (count > round.length) return null;
  // A give-up jumps straight to the result, so a finished round may hold
  // fewer answers than dates.
  if ((index as number) === round.length) return valid;
  if (count !== index && count !== (index as number) + 1) return null;
  return valid;
}

/** Whether the save of this round shows its result; the pilot keeps no stats. */
export function isMapPilotRoundFinished(roundDate: string): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(mapPilotStorageKey(roundDate)) ?? "null") as Partial<MapPilotSave> | null;
    return Array.isArray(saved?.events) && saved.events.length > 0 && saved.index === saved.events.length;
  } catch {
    return false;
  }
}

export function storeMapPilotSave(roundDate: string, save: MapPilotSave): void {
  try {
    localStorage.setItem(mapPilotStorageKey(roundDate), JSON.stringify(save));
  } catch {}
}
