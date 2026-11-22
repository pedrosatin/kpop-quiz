import type { Messages } from "../../i18n/catalog";
import type { TrailCheck } from "./types";

interface StrandsBarMessageProps {
  t: Messages["strands"];
  activeLetters: string;
  lastCheck: TrailCheck | null;
  wordName: (key: string) => string;
  foundCount: number;
  totalWords: number;
}

function verdictText(
  check: TrailCheck,
  t: Messages["strands"],
  wordName: (key: string) => string,
  foundCount: number,
  totalWords: number,
): string {
  switch (check.kind) {
    case "found":
      return check.isSpangram
        ? t.spangramFeedback(wordName(check.wordKey), foundCount, totalWords)
        : t.foundFeedback(wordName(check.wordKey), foundCount, totalWords);
    case "repeat":
      return t.repeatFeedback(wordName(check.wordKey));
    case "miss":
      return t.missFeedback(check.letters);
    case "too-short":
      return t.tooShortFeedback;
    case "cancelled":
      return t.cancelFeedback;
  }
}

/** Live status for the current trail or the last verdict (at most two lines). */
export function StrandsBarMessage({
  t,
  activeLetters,
  lastCheck,
  wordName,
  foundCount,
  totalWords,
}: StrandsBarMessageProps) {
  if (activeLetters.length > 0) {
    return (
      <p class="word-search-selection">
        <span class="selection-letters">{t.pathHint(activeLetters)}</span>
        <span class="visually-hidden"> {t.lettersCount(activeLetters.length)}</span>
      </p>
    );
  }
  if (lastCheck) {
    return (
      <p class="game-actions-title">
        {verdictText(lastCheck, t, wordName, foundCount, totalWords)}
      </p>
    );
  }
  return <p class="game-actions-hint">{t.selectionHint}</p>;
}
