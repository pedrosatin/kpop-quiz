import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WORD_SEARCH_I18N } from "./types";
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
  const t = WORD_SEARCH_I18N[locale];
  const isEasy = easyMode ?? clueMode ?? false;
  const toggleMode = onToggleEasyMode ?? onToggleClueMode;
  const themeTitle = puzzle.theme[locale] || puzzle.theme.en;
  const themeDesc = puzzle.theme_description?.[locale] || puzzle.theme_description?.en;

  return (
    <header class="word-search-header">
      <div class="word-search-theme-info">
        <h2 class="game-card-title word-search-theme-title">{themeTitle}</h2>
        {themeDesc && <p class="word-search-theme-desc">{themeDesc}</p>}
      </div>

      <div class="game-hud word-search-hud" role="region" aria-label={t.title}>
        <div class="hud-item">
          <span class="hud-label">{t.wordsFound}:</span>
          <strong class="hud-value" data-testid="found-counter">
            {foundCount} / {totalCount}
          </strong>
        </div>

        <div class="hud-item">
          <span class="hud-label">{t.timerLabel}:</span>
          <strong class="hud-value timer-display" data-testid="timer-display">
            {formatTime(elapsedSeconds)}
          </strong>
        </div>

        <button
          type="button"
          class="btn btn-secondary btn-sm toggle-mode-btn"
          onClick={toggleMode}
          aria-pressed={isEasy}
        >
          {isEasy ? t.normalMode : t.easyMode}
        </button>
      </div>
    </header>
  );
}
