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

/** Live status for the current trail or the last verdict. */
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
      <>
        <span class="visually-hidden">{t.selectionLabel} </span>
        {t.pathHint(activeLetters)}
        <span class="visually-hidden"> {t.lettersCount(activeLetters.length)}</span>
      </>
    );
  }
  if (lastCheck) {
    return <>{verdictText(lastCheck, t, wordName, foundCount, totalWords)}</>;
  }
  return <>{t.selectionHint}</>;
}
