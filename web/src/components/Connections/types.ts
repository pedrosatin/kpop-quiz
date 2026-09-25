import type {
  ConnectionsCategory,
  ConnectionsItem,
  ConnectionsPuzzle,
  Locale,
} from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export type ConnectionsGameStatus = "in_progress" | "won" | "lost";

export type ConnectionsDifficulty = 1 | 2 | 3 | 4;

export interface ConnectionsStoredState {
  solvedCategoryIds: string[];
  mistakesRemaining: number;
  guessHistory: string[][];
  gameStatus: ConnectionsGameStatus;
  boardItemIds: string[];
}

export interface GuessResult {
  success: boolean;
  oneAway: boolean;
  category?: ConnectionsCategory;
}

export interface ConnectionsGameProps {
  locale: Locale;
  baseUrl?: string;
  messages?: Messages;
  puzzle?: ConnectionsPuzzle;
}

export interface ConnectionsBoardProps {
  categories: ConnectionsCategory[];
  solvedCategoryIds: string[];
  boardItems: ConnectionsItem[];
  allItems: ConnectionsItem[];
  selectedItemIds: string[];
  onToggleItem: (id: string) => void;
  disabled?: boolean;
  locale: Locale;
  messages: Messages;
}

export interface ConnectionsTileProps {
  item: ConnectionsItem;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: (id: string) => void;
  locale: Locale;
  messages: Messages;
}

export interface CategoryBannerProps {
  category: ConnectionsCategory;
  allItems: ConnectionsItem[];
  items?: ConnectionsItem[];
  locale: Locale;
  messages: Messages;
}

export interface MistakesRemainingProps {
  mistakesRemaining: number;
  maxMistakes?: number;
  messages: Messages;
}

export interface ConnectionsResultsProps {
  puzzle: ConnectionsPuzzle;
  gameStatus: ConnectionsGameStatus;
  guessHistory: string[][];
  mistakesRemaining: number;
  onRestart: () => void;
  locale: Locale;
  messages: Messages;
}

/**
 * Share-text symbols per difficulty level. Banner colors live in
 * connections.css (.connections-banner-level-N) and use the --color-level-N tokens.
 */
export const DIFFICULTY_COLORS: Record<ConnectionsDifficulty, { emoji: string; mono: string }> = {
  1: { emoji: "🟨", mono: "①" },
  2: { emoji: "🟩", mono: "②" },
  3: { emoji: "🟦", mono: "③" },
  4: { emoji: "🟪", mono: "④" },
};
