import type { IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export type GridGameStatus = "loading" | "error" | "ready" | "cell_selected" | "complete";

export interface CellCoordinates {
  row: number;
  col: number;
}

export interface GridCellState {
  solved: boolean;
  entityId?: string;
  entityName?: string;
  failed: boolean;
  lastAttempt?: string;
}

/** What localStorage keeps of one grid, under `kpop-grid-<grid_id>`. */
export interface GridStoredState {
  guessesUsed: number;
  cells: Record<string, GridCellState>;
}

export interface GridGameState {
  status: GridGameStatus;
  grid: IntersectionGrid | null;
  selectedCell: CellCoordinates | null;
  guessesUsed: number;
  maxGuesses: number;
  cells: Record<string, GridCellState>;
  usedEntityIds: Set<string>;
  errorKind?: "missing" | "invalid";
  uniquenessError?: string | null;
}

export interface GridComponentProps {
  locale: Locale;
  baseUrl?: string;
  messages?: Messages;
}

export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
