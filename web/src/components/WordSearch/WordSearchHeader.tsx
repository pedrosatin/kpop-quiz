import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchHeaderProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
}

/** The theme above the grid; the progress and the timer live in the action bar. */
export function WordSearchHeader({ puzzle, locale }: WordSearchHeaderProps) {
  const themeTitle = puzzle.theme[locale] || puzzle.theme.en;
  const themeDesc = puzzle.theme_description?.[locale] || puzzle.theme_description?.en;

  return (
    <header class="word-search-header">
      <h2 class="word-search-theme-title">{themeTitle}</h2>
      {themeDesc && <p class="word-search-theme-desc">{themeDesc}</p>}
    </header>
  );
}
