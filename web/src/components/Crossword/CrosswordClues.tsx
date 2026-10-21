import type { CrosswordPuzzle } from "../../data/crossword";
import type { Messages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

/** Clue button text, e.g. "1 Across: Group whose members include J-Hope. (3)". */
export function clueText(puzzle: CrosswordPuzzle, index: number, locale: Locale, messages: Messages): string {
  const entry = puzzle.entries[index]!;
  const direction = entry.direction === "across" ? messages.crosswordAcross : messages.crosswordDown;
  return messages.crosswordClue(entry.number, direction, entry.clue[locale], entry.answer.length);
}

interface CrosswordCluesProps {
  puzzle: CrosswordPuzzle;
  locale: Locale;
  messages: Messages;
  active: number;
  finished: boolean;
  onSelect: (index: number) => void;
}

export function CrosswordClues({ puzzle, locale, messages, active, finished, onSelect }: CrosswordCluesProps) {
  return (
    <div class="crossword-clues-panel">
      <h2 class="crossword-clues-title">{messages.crosswordCluesHeading}</h2>
      <ol class="crossword-clues">
        {puzzle.entries.map((entry, index) => (
          <li key={entry.qid}>
            <button
              class="btn btn-secondary"
              type="button"
              aria-pressed={!finished && active === index}
              onClick={() => onSelect(index)}
              disabled={finished}
            >
              {clueText(puzzle, index, locale, messages)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
