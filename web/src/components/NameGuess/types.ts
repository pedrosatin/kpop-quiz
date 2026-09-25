import type { Locale, NameGuessPuzzle } from "../../lib/quiz-types";
import type { NameGuessMessages } from "../../i18n/catalog";

export type LetterStatus = "correct" | "present" | "absent";
export type TileStatus = LetterStatus | "empty" | "active";
export type GameStatus = "playing" | "won" | "lost";

export interface NameGuessGameProps {
  puzzle?: NameGuessPuzzle;
  locale: Locale;
  baseUrl?: string;
}

export type NameGuessTranslations = NameGuessMessages;
