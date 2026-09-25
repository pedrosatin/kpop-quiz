import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchListProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  foundWordIds: string[];
  easyMode?: boolean;
  clueMode?: boolean;
  onSelectEvidenceWord: (word: WordSearchWord) => void;
}

export function WordSearchList({
  puzzle,
  locale,
  foundWordIds,
  easyMode,
  clueMode,
  onSelectEvidenceWord,
}: WordSearchListProps) {
  const t = getMessages(locale).wordSearch;
  const isEasy = easyMode ?? clueMode ?? false;
  const clueFor = (word: WordSearchWord) => word.clue?.[locale] || word.clue?.en || "";
  // A clue shared by every word repeats the theme and tells the player nothing.
  const cluesAreIdentical =
    puzzle.words.length > 1 && puzzle.words.every((word) => clueFor(word) === clueFor(puzzle.words[0]!));

  return (
    <aside class="word-search-list-section" aria-label={t.wordsHeading}>
      <h2 class="word-search-list-heading">
        {t.wordsHeading}
      </h2>
      <ul class="word-search-words" role="list">
        {puzzle.words.map((word) => {
          const isFound = foundWordIds.includes(word.id);
          const localizedName = word.labels[locale] || word.canonical_name;
          const localizedClue = cluesAreIdentical ? "" : clueFor(word);
          const pendingHint = localizedClue
            ? `${localizedClue} (${t.lettersCount(word.word.length)})`
            : t.lettersCount(word.word.length);

          const displayText = isFound
            ? localizedName
            : isEasy
            ? localizedName
            : pendingHint;

          return (
            <li
              key={word.id}
              class={`word-search-item ${isFound ? "is-found" : ""}`}
              data-word-id={word.id}
            >
              <div class="word-content">
                {isFound && <span class="found-check" aria-hidden="true">✓ </span>}
                <span class={isFound ? "text-found" : "text-pending"}>
                  {displayText}
                </span>
              </div>
              <button
                type="button"
                class="evidence-trigger-btn"
                aria-label={`${t.viewEvidence}: ${localizedName}`}
                onClick={() => onSelectEvidenceWord(word)}
              >
                ℹ
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
