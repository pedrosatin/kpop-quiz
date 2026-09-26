import type { MapPilotEvent } from "../../data/map-pilot";

/**
 * What localStorage keeps of one daily round, under `kpop-map-<YYYY-MM-DD>`
 * (the round date):
 * `{ events: string[], answers: string[], index: number }`.
 * `events` are the MusicBrainz event MBIDs of the round in order, so a save
 * made before a data refresh changed the round is dropped. `answers` are
 * the map feature ids the player picked, one per answered date, in order.
 * `index` is the date on screen (0-based); it equals the number of dates
 * the player moved past, and `index === events.length` means the result is
 * showing. `answers` has `index` entries, or `index + 1` while the date on
 * screen is answered and Next was not pressed yet.
 */
export interface MapPilotSave {
  events: string[];
  answers: string[];
  index: number;
}

export function mapPilotStorageKey(roundDate: string): string {
  return `kpop-map-${roundDate}`;
}

const ROUND_KEY = /^kpop-map-\d{4}-\d{2}-\d{2}$/;

/** Removes the saves of other days, so old rounds do not pile up in storage. */
export function pruneMapPilotSaves(roundDate: string): void {
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
  const { events, answers, index } = saved as Partial<MapPilotSave>;
  if (!Array.isArray(events) || events.length !== round.length) return null;
  if (events.some((id, i) => id !== round[i]!.event_mbid)) return null;
  if (!Array.isArray(answers) || answers.some((id) => typeof id !== "string" || !playableFeatures.has(id))) return null;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > round.length) return null;
  const count = answers.length;
  if (count !== index && count !== (index as number) + 1) return null;
  if (count > round.length) return null;
  return { events: [...events], answers: [...answers], index: index as number };
}

export function storeMapPilotSave(roundDate: string, save: MapPilotSave): void {
  try {
    localStorage.setItem(mapPilotStorageKey(roundDate), JSON.stringify(save));
  } catch {}
}

export function clearMapPilotSave(roundDate: string): void {
  try {
    localStorage.removeItem(mapPilotStorageKey(roundDate));
  } catch {}
}
