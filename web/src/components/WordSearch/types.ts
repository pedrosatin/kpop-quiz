import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";

export interface CellCoord {
  row: number;
  col: number;
}

export type GameStatus = "in_progress" | "completed";

/** Outcome of a finished selection; n grows with every check, so a repeat is announced again. */
export type SelectionCheck =
  | { kind: "found" | "repeat"; wordId: string; n: number }
  | { kind: "miss"; letters: string; n: number };

export interface WordSearchGameProps {
  puzzle?: WordSearchPuzzle;
  locale: Locale;
  baseUrl?: string;
}
