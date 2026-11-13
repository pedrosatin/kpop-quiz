import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";

export interface CellCoord {
  row: number;
  col: number;
}

export type GameStatus = "in_progress" | "completed";

/**
 * Outcome of a finished or abandoned selection; n grows with every one, so a
 * repeat is announced again. "offline" is a second tap off the start's lines,
 * which became the new start; "cancelled" is Esc or a tap on the start.
 */
export type SelectionCheck =
  | { kind: "found" | "repeat"; wordId: string; n: number }
  | { kind: "partial" | "miss"; letters: string; n: number }
  | { kind: "offline"; from: string; n: number }
  | { kind: "cancelled"; n: number };

export interface WordSearchGameProps {
  puzzle?: WordSearchPuzzle;
  locale: Locale;
  baseUrl?: string;
}
