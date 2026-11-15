import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { isRecord } from "../../lib/guards";
import { getLocalStorageItem, listLocalStorageKeys, removeLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";

/**
 * What localStorage keeps of one daily round, under `kpop-code-<YYYY-MM-DD>`
 * (the puzzle date), following the map save: the board's `puzzle_id`, the
 * QIDs of every submitted guess in order and the current selection. The
 * exact/misplaced counts are recomputed from the secret, so a save never
 * shows a count play did not produce. A save for another date is pruned, and
 * one for another board of the same date (a republished day, or a save from
 * before the id was kept) is dropped instead of resumed.
 */
export interface CodeGroupsSave {
  puzzle_id: string;
  history: string[][];
  selection: string[];
}

export function codeGroupsStorageKey(roundDate: string): string {
  return `kpop-code-${roundDate}`;
}

const ROUND_KEY = /^kpop-code-\d{4}-\d{2}-\d{2}$/;

/** Removes the saves of other days, so old rounds do not pile up in storage. */
function pruneCodeGroupsSaves(roundDate: string): void {
  const keep = codeGroupsStorageKey(roundDate);
  for (const key of listLocalStorageKeys()) {
    if (key !== keep && ROUND_KEY.test(key)) removeLocalStorageItem(key);
  }
}

function isSymbolId(id: unknown, puzzle: CodeGroupsPuzzle): id is string {
  return typeof id === "string" && puzzle.symbols.some((s) => s.qid === id);
}

/** Four distinct groups, all among the six symbols. */
function isSavedGuess(ids: unknown, puzzle: CodeGroupsPuzzle): ids is string[] {
  if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4) return false;
  return ids.every((id) => isSymbolId(id, puzzle));
}

/** No more guesses than the limit, each a valid guess. */
function isSavedHistory(history: unknown, puzzle: CodeGroupsPuzzle): history is string[][] {
  if (!Array.isArray(history) || history.length > puzzle.max_attempts) return false;
  return history.every((ids) => isSavedGuess(ids, puzzle));
}

/**
 * Four slots, each empty or a symbol. A round out of attempts keeps its slots
 * empty, because the game clears them when the round ends.
 */
function isSavedSelection(selection: unknown, history: readonly string[][], puzzle: CodeGroupsPuzzle): selection is string[] {
  if (!Array.isArray(selection) || selection.length !== 4) return false;
  if (history.length === puzzle.max_attempts && selection.some((id) => id !== "")) return false;
  return selection.every((id) => id === "" || isSymbolId(id, puzzle));
}

function parseSave(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Reads the save of this round and removes the saves of other days. A save
 * with a group outside the six symbols, a repeated group, more guesses than
 * the limit or a selection of the wrong shape is dropped, so a stale or
 * edited save never shows a round the player did not play.
 */
export function loadCodeGroupsSave(puzzle: CodeGroupsPuzzle): CodeGroupsSave | null {
  pruneCodeGroupsSaves(puzzle.reference_date);
  const raw = getLocalStorageItem(codeGroupsStorageKey(puzzle.reference_date));
  if (!raw) return null;
  const saved = parseSave(raw);
  if (!isRecord(saved)) return null;
  const { puzzle_id, history, selection } = saved as Partial<CodeGroupsSave>;
  if (puzzle_id !== puzzle.puzzle_id) return null;
  if (!isSavedHistory(history, puzzle)) return null;
  if (!isSavedSelection(selection, history, puzzle)) return null;
  return { puzzle_id, history: history.map((ids) => [...ids]), selection: [...selection] };
}

export function storeCodeGroupsSave(puzzle: CodeGroupsPuzzle, save: Omit<CodeGroupsSave, "puzzle_id">): void {
  const stored: CodeGroupsSave = { puzzle_id: puzzle.puzzle_id, ...save };
  setLocalStorageItem(codeGroupsStorageKey(puzzle.reference_date), JSON.stringify(stored));
}

export function clearCodeGroupsSave(puzzle: CodeGroupsPuzzle): void {
  removeLocalStorageItem(codeGroupsStorageKey(puzzle.reference_date));
}
