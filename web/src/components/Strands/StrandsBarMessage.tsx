import type { Messages } from "../../i18n/catalog";
import type { TrailCheck } from "./types";

interface StrandsBarMessageProps {
  t: Messages["strands"];
  activeLetters: string;
  lastCheck: TrailCheck | null;
  wordName: (key: string) => string;
}

function verdictText(
  check: TrailCheck,
  t: Messages["strands"],
  wordName: (key: string) => string,
): string {
  switch (check.kind) {
    case "found":
      return check.isSpangram
        ? t.spangramFeedback(wordName(check.wordKey))
        : t.foundFeedback(wordName(check.wordKey));
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
    return <>{verdictText(lastCheck, t, wordName)}</>;
  }
  return <>{t.selectionHint}</>;
}
