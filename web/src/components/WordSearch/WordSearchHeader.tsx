import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import { formatTime } from "./utils";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchHeaderProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  foundCount: number;
  totalCount: number;
  elapsedSeconds: number;
  easyMode?: boolean;
  onToggleEasyMode?: () => void;
  clueMode?: boolean;
  onToggleClueMode?: () => void;
}

export function WordSearchHeader({
  puzzle,
  locale,
  foundCount,
  totalCount,
  elapsedSeconds,
  easyMode,
  onToggleEasyMode,
  clueMode,
  onToggleClueMode,
}: WordSearchHeaderProps) {
  const t = getMessages(locale).wordSearch;
  const isEasy = easyMode ?? clueMode ?? false;
  const toggleMode = onToggleEasyMode ?? onToggleClueMode;
  const themeTitle = puzzle.theme[locale] || puzzle.theme.en;
  const themeDesc = puzzle.theme_description?.[locale] || puzzle.theme_description?.en;

  return (
    <header class="word-search-header">
      <div class="word-search-theme-info">
        <h2 class="word-search-theme-title">{themeTitle}</h2>
        {themeDesc && <p class="word-search-theme-desc">{themeDesc}</p>}
      </div>

      <div class="word-search-meta-bar" role="region" aria-label={t.title}>
        <div class="meta-stat counter-stat">
          <span class="stat-label">{t.wordsFound}:</span>
          <strong class="stat-value" data-testid="found-counter">
            {foundCount} / {totalCount}
          </strong>
        </div>

        <div class="meta-stat timer-stat">
          <span class="stat-label">{t.timerLabel}:</span>
          <strong class="stat-value timer-display" data-testid="timer-display">
            {formatTime(elapsedSeconds)}
          </strong>
        </div>

        <div class="meta-actions">
          <button
            type="button"
            class="toggle-clue-btn toggle-mode-btn"
            onClick={toggleMode}
          >
            {isEasy ? t.hideWords : t.showWords}
          </button>
        </div>
      </div>
    </header>
  );
}
