import { useState } from "preact/hooks";
import type { SeoRouteKey } from "../../i18n/catalog";
import { getMessages } from "../../i18n/catalog";
import { isDailyMatchRecorded, type GameId } from "../../lib/player-stats";
import type { Locale } from "../../lib/quiz-types";
import { DailyNext } from "./DailyNext";

/**
 * Whether the game shows `DailyDone` instead of its board: the day's match was
 * already counted when the game mounted and this board is not finished, so the
 * date's board was republished after the player finished it (ADR 030).
 */
export function useDailyMatchDone(gameId: GameId, dateStr: string, legacyMatchId: string, finished: boolean): boolean {
  const [counted] = useState(() => isDailyMatchRecorded(gameId, dateStr, legacyMatchId));
  return counted && !finished;
}

/** The day's challenge, already finished on an earlier board of the same date. */
export function DailyDone({ game, locale }: { game: SeoRouteKey; locale: Locale }) {
  const messages = getMessages(locale);
  return (
    <section class="game-card state daily-done" data-testid="daily-done" aria-labelledby="daily-done-title">
      <h2 id="daily-done-title">{messages.dailyDoneTitle}</h2>
      <p>{messages.dailyDoneBody}</p>
      <DailyNext game={game} locale={locale} />
    </section>
  );
}
