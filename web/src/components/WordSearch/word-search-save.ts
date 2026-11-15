import type { GameStatus } from "./types";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";
import { isRecord } from "../../lib/guards";

/**
 * The round stored per puzzle. Saves written before easy mode had that name
 * carry `clueMode`; both are read and both come back set the same.
 */
export interface StoredProgress {
  foundWordIds: string[];
  elapsedSeconds: number;
  status: GameStatus;
  easyMode: boolean;
  clueMode?: boolean;
}

export function wordSearchStorageKey(puzzleId: string): string {
  return `kpop-word-search-${puzzleId}`;
}

function freshProgress(): StoredProgress {
  return { foundWordIds: [], elapsedSeconds: 0, status: "in_progress", easyMode: false, clueMode: false };
}

function parseStored(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Distinct ids, each one of the puzzle's words when `validWordIds` is given. */
export function isFoundWordIds(value: unknown, validWordIds?: ReadonlySet<string>): value is string[] {
  return Array.isArray(value)
    && value.every((id) => typeof id === "string" && (validWordIds === undefined || validWordIds.has(id)))
    && new Set(value).size === value.length;
}

/** A count of seconds from the save, or 0 when it is not a finite number at least 0. */
export function storedSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The stored round, or a fresh one when the save is missing, unreadable, or
 * lists a word twice or a word the puzzle does not have. Other fields fall
 * back one by one.
 */
export function loadStoredProgress(key: string, validWordIds?: ReadonlySet<string>): StoredProgress {
  const parsed = parseStored(getLocalStorageItem(key));
  if (!isRecord(parsed) || !isFoundWordIds(parsed.foundWordIds, validWordIds)) return freshProgress();
  const isEasy = Boolean(parsed.easyMode ?? parsed.clueMode);
  return {
    foundWordIds: parsed.foundWordIds,
    elapsedSeconds: storedSeconds(parsed.elapsedSeconds),
    status: parsed.status === "completed" ? "completed" : "in_progress",
    easyMode: isEasy,
    clueMode: isEasy,
  };
}

/** Writes the round in the shape loadStoredProgress reads. */
export function storeProgress(key: string, state: StoredProgress): void {
  setLocalStorageItem(key, JSON.stringify(state));
}
