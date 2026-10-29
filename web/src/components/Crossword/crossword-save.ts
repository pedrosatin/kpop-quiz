import { entryCellKeys, type CrosswordEntry, type CrosswordPuzzle } from "../../data/crossword";

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
  try {
    const keep = crosswordStorageKey(puzzle);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key !== keep && BOARD_KEY.test(key)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {}
}

export function isEntrySolved(entry: CrosswordEntry, values: Readonly<Record<string, string>>): boolean {
  return entryCellKeys(entry).every((key, i) => values[key] === entry.answer[i]);
}

export function isBoardSolved(puzzle: CrosswordPuzzle, values: Readonly<Record<string, string>>): boolean {
  return puzzle.cells.every((cell) => values[`${cell.row}:${cell.col}`] === cell.answer);
}

/**
 * Reads the save of this board and removes the saves of other boards. A save
 * with a square outside the board, more than one character in a square, an
 * unknown status or a "won" status the letters do not solve is dropped, so an
 * edited save never shows a round the player did not play.
 */
export function loadCrosswordSave(puzzle: CrosswordPuzzle): CrosswordSave | null {
  pruneCrosswordSaves(puzzle);
  let saved: unknown;
  try {
    const raw = localStorage.getItem(crosswordStorageKey(puzzle));
    if (!raw) return null;
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
  try {
    localStorage.setItem(crosswordStorageKey(puzzle), JSON.stringify(save));
  } catch {}
}

export function clearCrosswordSave(puzzle: CrosswordPuzzle): void {
  try {
    localStorage.removeItem(crosswordStorageKey(puzzle));
  } catch {}
}
