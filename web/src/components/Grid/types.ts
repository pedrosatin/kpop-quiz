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
  /** Name of entityId in the page's language, read from the pool. */
  entityName?: string;
  failed: boolean;
  /** QID of the last wrong group tried in this cell. */
  lastAttemptId?: string;
  /** Name of lastAttemptId in the page's language, read from the pool. */
  lastAttempt?: string;
}

/** One cell as saved: QIDs only, so names follow the page's language. */
export interface GridStoredCell {
  solved: boolean;
  failed: boolean;
  entityId?: string;
  lastAttemptId?: string;
}

/**
 * What localStorage keeps of one grid, under `kpop-grid-<grid_id>`:
 * `{ guessesUsed: 0..9, cells: { "row,col": GridStoredCell } }` with all
 * nine cells. A solved cell has `entityId`; a failed one may have
 * `lastAttemptId`. Both are candidate pool QIDs.
 */
export interface GridStoredState {
  guessesUsed: number;
  cells: Record<string, GridStoredCell>;
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
