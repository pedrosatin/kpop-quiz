import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import { sameCell } from "./geometry";
import { getLinearPath, isWordMatch } from "./utils";

/** What a finished selection means, before it is numbered for the live region. */
export type SelectionVerdict =
  | { kind: "found" | "repeat"; wordId: string }
  | { kind: "partial" | "miss"; letters: string };

function wordPath(word: WordSearchWord): CellCoord[] {
  return getLinearPath({ row: word.start_row, col: word.start_col }, { row: word.end_row, col: word.end_col });
}

/** Both ends on the word's line, so every cell between them is too. */
function liesWithin(word: WordSearchWord, start: CellCoord, end: CellCoord): boolean {
  const path = wordPath(word);
  return path.some((cell) => sameCell(cell, start)) && path.some((cell) => sameCell(cell, end));
}

/**
 * The verdict of a straight selection of two cells or more: a name not yet
 * found, a name already found, a piece of a name that does not count on its
 * own (SEOK inside KIMSEOKJIN), or letters that are not a name.
 */
export function judgeSelection(
  puzzle: WordSearchPuzzle,
  foundWordIds: readonly string[],
  start: CellCoord,
  end: CellCoord,
  locale: Locale,
): SelectionVerdict {
  const path = getLinearPath(start, end);
  const letters = path.map((c) => puzzle.grid[c.row]?.[c.col] ?? "").join("");
  const revLetters = letters.split("").reverse().join("");
  const matches = (word: WordSearchWord) =>
    path.length >= 3 && isWordMatch(word, start, end, letters, revLetters, locale);
  const within = (word: WordSearchWord) => liesWithin(word, start, end);
  const pending = puzzle.words.filter((word) => !foundWordIds.includes(word.id));
  const done = puzzle.words.filter((word) => foundWordIds.includes(word.id));

  const match = pending.find(matches);
  if (match) return { kind: "found", wordId: match.id };
  const again = done.find(matches);
  if (again) return { kind: "repeat", wordId: again.id };
  if (pending.some(within)) return { kind: "partial", letters };
  // A piece of a name already found points back to that name.
  const piece = done.find(within);
  return piece ? { kind: "repeat", wordId: piece.id } : { kind: "miss", letters };
}

/**
 * What a tap (or Enter) on target does, given the start marked before it: it
 * marks the start, cancels on the start itself, closes a straight selection,
 * or, off the start's lines, moves the start there and says so.
 */
export type TapAction = "start" | "cancel" | "check" | "offline";

export function resolveTap(priorAnchor: CellCoord | null, target: CellCoord): TapAction {
  if (!priorAnchor) return "start";
  if (sameCell(priorAnchor, target)) return "cancel";
  return getLinearPath(priorAnchor, target).length > 0 ? "check" : "offline";
}
