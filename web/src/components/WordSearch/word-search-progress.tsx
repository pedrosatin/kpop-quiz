import type { Messages } from "../../i18n/catalog";
import { formatTime } from "./utils";

interface WordSearchProgressProps {
  t: Messages["wordSearch"];
  foundCount: number;
  totalWords: number;
  elapsedSeconds: number;
}

/** Words found and the timer, in the action bar while the round is open. */
export function WordSearchProgress({ t, foundCount, totalWords, elapsedSeconds }: WordSearchProgressProps) {
  return (
    <dl class="word-search-progress">
      <div>
        <dt>{t.wordsFound}</dt>
        <dd data-testid="found-counter">{t.progress(foundCount, totalWords)}</dd>
      </div>
      <div>
        <dt>{t.timerLabel}</dt>
        <dd class="timer-display" data-testid="timer-display">{formatTime(elapsedSeconds)}</dd>
      </div>
    </dl>
  );
}
