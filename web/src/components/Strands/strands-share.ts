import type { StrandsPuzzle } from "../../lib/strands-types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";

export function formatStrandsTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function generateStrandsShareSummary(
  puzzle: StrandsPuzzle,
  foundCount: number,
  totalCount: number,
  elapsedSeconds: number,
  locale: Locale,
  options: { daily?: boolean; shareUrl?: string } = {},
): string {
  const time = formatStrandsTime(elapsedSeconds);
  const messages = getMessages(locale);
  const body =
    options.daily === false
      ? `${messages.gameStrands}\n${foundCount}/${totalCount} (${time})`
      : messages.strandsShareHeader(puzzle.reference_date, foundCount, totalCount, time);
  return withShareUrl(body, options.shareUrl ?? seoShareUrl("strands", locale));
}
