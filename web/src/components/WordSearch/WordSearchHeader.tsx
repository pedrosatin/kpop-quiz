import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchHeaderProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  /** Inside a group-page section (already an h2), demote to h3. Defaults to 2. */
  headingLevel?: 2 | 3;
}

/** The theme above the grid; the progress and the timer live in the action bar. */
export function WordSearchHeader({ puzzle, locale, headingLevel = 2 }: WordSearchHeaderProps) {
  const themeTitle = puzzle.theme[locale] || puzzle.theme.en;
  const themeDesc = puzzle.theme_description?.[locale] || puzzle.theme_description?.en;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <header class="word-search-header">
      <Heading class="word-search-theme-title">{themeTitle}</Heading>
      {themeDesc && <p class="word-search-theme-desc">{themeDesc}</p>}
    </header>
  );
}
