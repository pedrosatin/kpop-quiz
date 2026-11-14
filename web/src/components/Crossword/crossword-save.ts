import { entryCellKeys, type CrosswordEntry, type CrosswordPuzzle } from "../../data/crossword";
import { getLocalStorageItem, listLocalStorageKeys, removeLocalStorageItem, setLocalStorageItem } from "../../lib/local-storage";

export type CrosswordStatus = "playing" | "won" | "revealed";

/**
 * What localStorage keeps of the crossword, under
 * `kpop-crossword-<dataset_version>`, the SHA-256 of the day's envelope. It
 * covers the date, so each day's board has its own key and a new board starts
 * clean.
 * `values` maps "row:col" to the letter the player typed, `checks` counts the
 * presses of Check answers and `status` says how the round ended. A revealed
 * round keeps the player's letters, so the result can still count the words
 * that were right before the reveal.
 */
export interface CrosswordSave {
  values: Record<string, string>;
  status: CrosswordStatus;
  checks: number;
}

export function crosswordStorageKey(puzzle: Pick<CrosswordPuzzle, "dataset_version">): string {
  return `kpop-crossword-${puzzle.dataset_version}`;
}

const BOARD_KEY = /^kpop-crossword-[a-f0-9]{64}$/;

/** Removes the saves of other boards, so replaced boards do not pile up. */
function pruneCrosswordSaves(puzzle: CrosswordPuzzle): void {
  const keep = crosswordStorageKey(puzzle);
  for (const key of listLocalStorageKeys()) {
    if (key !== keep && BOARD_KEY.test(key)) removeLocalStorageItem(key);
  }
}

export function isEntrySolved(entry: CrosswordEntry, values: Readonly<Record<string, string>>): boolean {
  return entryCellKeys(entry).every((key, i) => values[key] === entry.answer[i]);
}

export function isBoardSolved(puzzle: CrosswordPuzzle, values: Readonly<Record<string, string>>): boolean {
  return wrongSquares(puzzle, values).size === 0;
}

/** The squares ("row:col") whose letter is wrong or missing. */
export function wrongSquares(puzzle: CrosswordPuzzle, values: Readonly<Record<string, string>>): Set<string> {
  const wrong = new Set<string>();
  for (const cell of puzzle.cells) {
    const key = `${cell.row}:${cell.col}`;
    if (values[key] !== cell.answer) wrong.add(key);
  }
  return wrong;
}

/**
 * Reads the save of this board and removes the saves of other boards. A save
 * with a square outside the board, more than one character in a square, an
 * unknown status or a "won" status the letters do not solve is dropped, so an
 * edited save never shows a round the player did not play.
 */
export function loadCrosswordSave(puzzle: CrosswordPuzzle): CrosswordSave | null {
  pruneCrosswordSaves(puzzle);
  const raw = getLocalStorageItem(crosswordStorageKey(puzzle));
  if (!raw) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
  const { values, status, checks } = saved as Partial<CrosswordSave>;
  if (status !== "playing" && status !== "won" && status !== "revealed") return null;
  if (!Number.isSafeInteger(checks) || (checks as number) < 0) return null;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const cells = new Set(puzzle.cells.map((c) => `${c.row}:${c.col}`));
  for (const [key, letter] of Object.entries(values)) {
    if (!cells.has(key) || typeof letter !== "string" || !/^[A-Z0-9]?$/.test(letter)) return null;
  }
  if (status === "won" && (!isBoardSolved(puzzle, values) || checks === 0)) return null;
  return { values: { ...values }, status, checks: checks as number };
}

export function storeCrosswordSave(puzzle: CrosswordPuzzle, save: CrosswordSave): void {
  setLocalStorageItem(crosswordStorageKey(puzzle), JSON.stringify(save));
}

export function clearCrosswordSave(puzzle: CrosswordPuzzle): void {
  removeLocalStorageItem(crosswordStorageKey(puzzle));
}
