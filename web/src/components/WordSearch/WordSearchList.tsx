import { useId } from "preact/hooks";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { buildLocalizedDisplayNames } from "../../lib/display-name";
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

function clueFor(word: WordSearchWord, locale: Locale): string {
  return word.clue?.[locale] || word.clue?.en || "";
}

/** A clue shared by every word repeats the theme and tells the player nothing. */
export function cluesAreIdentical(words: readonly WordSearchWord[], locale: Locale): boolean {
  return words.length > 1 && words.every((word) => clueFor(word, locale) === clueFor(words[0]!, locale));
}

interface WordSearchChipProps {
  t: Messages["wordSearch"];
  word: WordSearchWord;
  index: number;
  name: string;
  /** Empty when the clues say nothing; the letter count stands alone then. */
  clue: string;
  found: boolean;
  /** Easy mode lists every name before it is found. */
  showName: boolean;
}

function WordSearchChip({ t, word, index, name, clue, found, showName }: WordSearchChipProps) {
  // The count wraps as a whole when a clue fills the chip.
  const pendingHint = clue
    ? <>{clue} <span class="word-search-count">({t.lettersCount(word.word.length)})</span></>
    : t.lettersCount(word.word.length);

  return (
    <li
      class={`word-search-item${found ? ` is-found color-${index % 6}` : ""}`}
      data-word-id={word.id}
    >
      {found && <span class="found-check" aria-hidden="true">✓</span>}
      <span class={found ? "text-found" : "text-pending"}>{found || showName ? name : pendingHint}</span>
      {found && <span class="visually-hidden">{`, ${t.foundState}`}</span>}
    </li>
  );
}

/**
 * The words to find as compact chips, all on screen at once: on phones they
 * wrap in two columns under the grid (word-search.css). A found chip takes
 * the color its word has on the grid and says "found" in text, so the state
 * does not rest on color alone.
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
  const displayNames = buildLocalizedDisplayNames(puzzle.words, locale);
  const headingId = useId();
  const isEasy = easyMode ?? clueMode ?? false;
  const hideClues = cluesAreIdentical(puzzle.words, locale);

  return (
    <aside class="word-search-list-section" aria-label={t.wordsHeading}>
      <h2 id={headingId} class="word-search-list-heading">{t.wordsHeading}</h2>
      <ul class="word-search-words" role="list" aria-labelledby={headingId}>
        {puzzle.words.map((word, index) => (
          <WordSearchChip
            key={word.id}
            t={t}
            word={word}
            index={index}
            name={displayNames.get(word.id) ?? word.canonical_name}
            clue={hideClues ? "" : clueFor(word, locale)}
            found={foundWordIds.includes(word.id)}
            showName={isEasy}
          />
        ))}
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
