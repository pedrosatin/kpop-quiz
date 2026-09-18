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
  items: ConnectionsItem[];
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

export const DIFFICULTY_COLORS: Record<
  ConnectionsDifficulty,
  { bg: string; text: string; emoji: string; mono: string }
> = {
  1: { bg: "#fde047", text: "#1f2937", emoji: "🟨", mono: "①" },
  2: { bg: "#86efac", text: "#064e3b", emoji: "🟩", mono: "②" },
  3: { bg: "#93c5fd", text: "#1e3a8a", emoji: "🟦", mono: "③" },
  4: { bg: "#d8b4fe", text: "#581c87", emoji: "🟪", mono: "④" },
};
