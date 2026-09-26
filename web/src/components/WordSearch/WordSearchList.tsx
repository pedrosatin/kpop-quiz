import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchListProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  foundWordIds: string[];
  easyMode?: boolean;
  clueMode?: boolean;
  onToggleEasyMode?: () => void;
  /** Hides the toggle once every name is on the list. */
  completed?: boolean;
}

/**
 * The words to find as compact chips. A found chip takes the color its word
 * has on the grid and says "found" in text, so the state does not rest on
 * color alone.
 */
export function WordSearchList({
  puzzle,
  locale,
  foundWordIds,
  easyMode,
  clueMode,
  onToggleEasyMode,
  completed = false,
}: WordSearchListProps) {
  const t = getMessages(locale).wordSearch;
  const isEasy = easyMode ?? clueMode ?? false;
  const clueFor = (word: WordSearchWord) => word.clue?.[locale] || word.clue?.en || "";
  // A clue shared by every word repeats the theme and tells the player nothing.
  const cluesAreIdentical =
    puzzle.words.length > 1 && puzzle.words.every((word) => clueFor(word) === clueFor(puzzle.words[0]!));

  return (
    <aside class="word-search-list-section" aria-label={t.wordsHeading}>
      <h2 class="word-search-list-heading">{t.wordsHeading}</h2>
      <ul class="word-search-words" role="list">
        {puzzle.words.map((word, index) => {
          const isFound = foundWordIds.includes(word.id);
          const localizedName = word.labels[locale] || word.canonical_name;
          const localizedClue = cluesAreIdentical ? "" : clueFor(word);
          const pendingHint = localizedClue
            ? `${localizedClue} (${t.lettersCount(word.word.length)})`
            : t.lettersCount(word.word.length);
          const displayText = isFound || isEasy ? localizedName : pendingHint;

          return (
            <li
              key={word.id}
              class={`word-search-item${isFound ? ` is-found color-${index % 6}` : ""}`}
              data-word-id={word.id}
            >
              {isFound && <span class="found-check" aria-hidden="true">✓</span>}
              <span class={isFound ? "text-found" : "text-pending"}>{displayText}</span>
              {isFound && <span class="visually-hidden">{`, ${t.foundState}`}</span>}
            </li>
          );
        })}
      </ul>
      {/* After the chips, so on phones the first row sits right under the grid. */}
      {!completed && onToggleEasyMode && (
        <button type="button" class="btn btn-secondary btn-sm toggle-mode-btn" onClick={onToggleEasyMode}>
          {isEasy ? t.hideWords : t.showWords}
        </button>
      )}
    </aside>
  );
}
