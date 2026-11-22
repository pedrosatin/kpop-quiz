import type { WordSearchWord } from "../../lib/word-search-types";
import type { CellCoord, GameStatus } from "./types";
import { getLinearPath } from "./utils";

const FOUND_COLORS = 6;

/** How the grid, the found-word map and the revealed set name a cell. */
export function cellKey(cell: CellCoord): string {
  return `${cell.row},${cell.col}`;
}

/** The cells of a word, from its first letter to its last. */
export function wordPath(word: WordSearchWord): CellCoord[] {
  return getLinearPath({ row: word.start_row, col: word.start_col }, { row: word.end_row, col: word.end_col });
}

/**
 * A finished round with words left is a give-up. A round only ends by itself
 * once every word is found.
 */
export function hasGivenUp(status: GameStatus, foundCount: number, totalCount: number): boolean {
  return status === "completed" && foundCount < totalCount;
}

/** The analytics outcome of a finished round, a win or a give-up. Null while the round goes on. */
export function roundOutcome(status: GameStatus, foundCount: number, totalCount: number): "win" | "give_up" | null {
  if (status !== "completed") return null;
  return hasGivenUp(status, foundCount, totalCount) ? "give_up" : "win";
}

/**
 * The color index of each cell of a found word, keyed by cellKey. A cell
 * two found words share takes the color of the later word in the list.
 */
export function foundCellColors(words: readonly WordSearchWord[], foundWordIds: readonly string[]): Map<string, number> {
  const colors = new Map<string, number>();
  words.forEach((word, wordIndex) => {
    if (!foundWordIds.includes(word.id)) return;
    for (const cell of wordPath(word)) colors.set(cellKey(cell), wordIndex % FOUND_COLORS);
  });
  return colors;
}

/** The cells of the words never found, marked after a give-up; none otherwise. */
export function revealedCellKeys(
  status: GameStatus,
  words: readonly WordSearchWord[],
  foundWordIds: readonly string[],
): Set<string> {
  const cells = new Set<string>();
  if (!hasGivenUp(status, foundWordIds.length, words.length)) return cells;
  for (const word of words) {
    if (foundWordIds.includes(word.id)) continue;
    for (const cell of wordPath(word)) cells.add(cellKey(cell));
  }
  return cells;
}

/**
 * The line being selected: from the start to the cell under the pointer, or
 * to the focused cell when the pointer is elsewhere. Empty without a start or
 * when the two cells are not on one line.
 */
export function selectionPath(anchor: CellCoord | null, hover: CellCoord | null, focus: CellCoord): CellCoord[] {
  if (!anchor) return [];
  return getLinearPath(anchor, hover ?? focus);
}
