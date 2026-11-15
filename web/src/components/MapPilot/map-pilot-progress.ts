/*
  The round's save as the game reads and writes it. The stored format, its
  key and the finished check live in map-pilot-save.ts, which the daily
  progress of every page imports. The reading, the checks and the choice of
  when to save stay here, so the other pages do not download them.
*/
import type { MapPilotEvent } from "../../data/map-pilot";
import { isRecord } from "../../lib/guards";
import { getLocalStorageItem, listLocalStorageKeys, removeLocalStorageItem } from "../../lib/local-storage";
import { mapPilotStorageKey, type MapPilotSave } from "./map-pilot-save";
import type { RoundState } from "./map-pilot-turn";

const ROUND_KEY = /^kpop-map-\d{4}-\d{2}-\d{2}$/;

/** Removes the saves of other days, so old rounds do not pile up in storage. */
function pruneMapPilotSaves(roundDate: string): void {
  const keep = mapPilotStorageKey(roundDate);
  for (const key of listLocalStorageKeys()) {
    if (key !== keep && ROUND_KEY.test(key)) removeLocalStorageItem(key);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Checks the round's event MBIDs in order. A data refresh that changes the round invalidates the save. */
function isRoundEvents(events: unknown, round: readonly MapPilotEvent[]): events is string[] {
  return Array.isArray(events)
    && events.length === round.length
    && events.every((id, i) => id === round[i]!.event_mbid);
}

function isPlayableAnswers(answers: unknown, playableFeatures: ReadonlySet<string>): answers is string[] {
  return Array.isArray(answers) && answers.every((id) => typeof id === "string" && playableFeatures.has(id));
}

/** A date of the round, or the round's length while the result shows. */
function isRoundIndex(index: unknown, roundLength: number): index is number {
  return Number.isInteger(index) && (index as number) >= 0 && (index as number) <= roundLength;
}

/** A give-up mark is a boolean, and a give-up jumps straight to the result. */
function isGiveUpMark(gaveUp: unknown, index: number, roundLength: number): boolean {
  if (gaveUp === undefined) return true;
  if (typeof gaveUp !== "boolean") return false;
  return gaveUp === false || index === roundLength;
}

/**
 * Play reaches `index` answers, or one more while the date on screen is
 * answered. A give-up jumps straight to the result, so a finished round may
 * hold fewer answers than dates.
 */
function isReachableAnswerCount(count: number, index: number, roundLength: number): boolean {
  if (count > roundLength) return false;
  if (index === roundLength) return true;
  return count === index || count === index + 1;
}

/**
 * Reads a raw save of this round. A save for other events, with a feature
 * outside the playable countries, or with a count that play cannot reach
 * is dropped, so a stale or edited save never shows a round the player did
 * not play.
 */
export function parseMapPilotSave(
  raw: string | null,
  round: readonly MapPilotEvent[],
  playableFeatures: ReadonlySet<string>,
): MapPilotSave | null {
  if (!raw) return null;
  const saved = parseJson(raw);
  if (!isRecord(saved)) return null;
  const { events, answers, index, replay, gaveUp } = saved;
  if (!isRoundEvents(events, round)) return null;
  if (!isPlayableAnswers(answers, playableFeatures)) return null;
  if (!isRoundIndex(index, round.length)) return null;
  if (!isGiveUpMark(gaveUp, index, round.length)) return null;
  if (!isReachableAnswerCount(answers.length, index, round.length)) return null;
  return {
    events: [...events],
    answers: [...answers],
    index,
    ...(gaveUp === true ? { gaveUp: true } : {}),
    ...(replay === true ? { replay: true } : {}),
  };
}

/** Reads the save of this round and removes the saves of other days. */
export function loadMapPilotSave(
  roundDate: string,
  round: readonly MapPilotEvent[],
  playableFeatures: ReadonlySet<string>,
): MapPilotSave | null {
  pruneMapPilotSaves(roundDate);
  return parseMapPilotSave(getLocalStorageItem(mapPilotStorageKey(roundDate)), round, playableFeatures);
}

/** The round as the game starts it: from the save, else from its first date. */
export function roundStateFromSave(date: string, saved: MapPilotSave | null): RoundState {
  if (saved === null) return { date, gaveUp: false, answers: [], index: 0, replay: false };
  return { date, gaveUp: saved.gaveUp === true, answers: saved.answers, index: saved.index, replay: saved.replay === true };
}

/**
 * An untouched round is not saved, but a finished one is, even with zero
 * answers after a give-up. So is a replay, or a reload would turn it back
 * into the day's round.
 */
export function shouldSaveRound(game: RoundState, round: readonly MapPilotEvent[], isComplete: boolean): boolean {
  if (round.length === 0) return false;
  return game.answers.length > 0 || isComplete || game.replay === true;
}

export function saveOfRound(game: RoundState, round: readonly MapPilotEvent[]): MapPilotSave {
  return {
    events: round.map((event) => event.event_mbid),
    answers: game.answers,
    index: game.index,
    ...(game.gaveUp ? { gaveUp: true } : {}),
    ...(game.replay ? { replay: true } : {}),
  };
}
