import type { Locale } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";

export interface CellCoord {
  row: number;
  col: number;
}

export type GameStatus = "in_progress" | "completed";

export interface WordSearchGameProps {
  puzzle?: WordSearchPuzzle;
  locale: Locale;
  baseUrl?: string;
}
