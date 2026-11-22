import type { Messages } from "../../i18n/catalog";

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface StrandsProgressProps {
  t: Messages["strands"];
  foundCount: number;
  totalWords: number;
  spangramFound: boolean;
  elapsedSeconds: number;
}

/**
 * Progress in text (words found plus spangram state) and the timer. Color is
 * never the only signal.
 */
export function StrandsProgress({
  t,
  foundCount,
  totalWords,
  spangramFound,
  elapsedSeconds,
}: StrandsProgressProps) {
  return (
    <dl class="strands-progress word-search-progress">
      <div>
        <dt>{t.wordsFound}</dt>
        <dd data-testid="found-counter">{t.progress(foundCount, totalWords)}</dd>
      </div>
      <div>
        <dt>{t.spangramLabel}</dt>
        <dd data-testid="spangram-status">
          {spangramFound ? t.spangramFound : t.spangramPending}
        </dd>
      </div>
      <div>
        <dt>{t.timerLabel}</dt>
        <dd class="timer-display" data-testid="timer-display">{formatTime(elapsedSeconds)}</dd>
      </div>
      <span class="visually-hidden" data-testid="progress-announcement">
        {t.progressAnnouncement(foundCount, totalWords, spangramFound)}
      </span>
    </dl>
  );
}
