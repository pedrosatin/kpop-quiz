import type { Locale } from "../../lib/quiz-types";
import type { StrandsPuzzle } from "../../lib/strands-types";

export interface CellCoord {
  row: number;
  col: number;
}

export type GameStatus = "in_progress" | "completed";

export type TrailVerdict =
  | { kind: "found"; wordKey: string; isSpangram: boolean }
  | { kind: "repeat"; wordKey: string; isSpangram: boolean }
  | { kind: "miss"; letters: string }
  | { kind: "too-short" }
  | { kind: "cancelled" };

export type TrailCheck = TrailVerdict & { n: number };

export interface StrandsGameProps {
  puzzle?: StrandsPuzzle;
  locale: Locale;
  baseUrl?: string;
  daily?: boolean;
  headingLevel?: 2 | 3;
}
