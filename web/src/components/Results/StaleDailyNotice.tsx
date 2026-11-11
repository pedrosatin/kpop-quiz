import { staleDailyDate } from "../../data/daily-artifact";
import { getMessages } from "../../i18n/catalog";
import { formatCalendarDate } from "../../lib/format-date";
import type { Locale } from "../../lib/quiz-types";

/**
 * Above a daily game whose loader found no board for today: the date of the
 * board on screen and that today's is not out. Nothing otherwise. Its height
 * comes out of the board budgets (--stale-notice-h in components.css).
 */
export function StaleDailyNotice({ board, locale }: { board: object | null | undefined; locale: Locale }) {
  const date = staleDailyDate(board);
  if (!date) return null;
  return (
    <p class="alert-warning stale-daily-notice" role="status" data-testid="stale-daily-notice">
      {getMessages(locale).staleDaily(formatCalendarDate(date, locale))}
    </p>
  );
}
