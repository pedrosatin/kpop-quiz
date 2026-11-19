import { useEffect, useId, useState } from "preact/hooks";
import type { SeoRouteKey } from "../../i18n/catalog";
import { getMessages } from "../../i18n/catalog";
import { dailyReferenceDate, secondsUntilNextDaily } from "../../data/daily-artifact";
import {
  buildDailySetShareText,
  recordDailySetComplete,
  rememberDailySetLine,
} from "../../lib/daily-set";
import { completedDailyGames, DAILY_DONE_EVENT, DAILY_GAMES, dailyGamePath, formatCountdown, nextDailyGame, statsGameId } from "../../lib/daily-progress";
import { trackDailySetComplete } from "../../lib/game-analytics";
import { loadPlayerStats } from "../../lib/player-stats";
import type { Locale } from "../../lib/quiz-types";
import { seoGameName } from "../../lib/seo-routes";
import { useGameShareAction } from "./use-game-share-action";

interface Plan {
  next: SeoRouteKey | null;
  /** Epoch ms of the next midnight in Sao Paulo. */
  deadline: number;
  /** True when every daily game of today is finished. */
  setComplete: boolean;
  setsCompleted: number;
  setShareText: string | null;
  /** True the first time this visit records today's set. */
  setJustRecorded: boolean;
}

/**
 * End of a daily game: time left until the next challenge and a link to
 * the next game not finished today. When the ninth game closes the day,
 * celebrates the set (no intermediate X/9 counter) and offers the day share.
 * It reads the clock and storage only after mounting, so the server and the
 * first client render agree.
 */
export function DailyNext({
  game,
  locale,
  shareText,
}: {
  game: SeoRouteKey;
  locale: Locale;
  /** Full share text of this game (URL included); stored for the day summary. */
  shareText?: string;
}) {
  const messages = getMessages(locale);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [now, setNow] = useState(0);
  const titleId = useId();
  const { copied, shareFailed, handleShare } = useGameShareAction({
    analytics: { game: "quiz", locale, daily: "yes" },
  });

  useEffect(() => {
    const start = new Date();
    const today = dailyReferenceDate(start);
    if (shareText) {
      rememberDailySetLine(today, statsGameId(game), shareText);
    }
    const done = completedDailyGames(today);
    // The game that just finished may not have flushed lastPlayedDate yet for
    // the map (save-based) path; include the current route so the ninth game
    // sees a complete set in the same paint as DailyNext mounts.
    done.add(game);
    const setComplete = DAILY_GAMES.every((key) => done.has(key));
    let setJustRecorded = false;
    if (setComplete) {
      setJustRecorded = recordDailySetComplete(today, true);
      if (setJustRecorded) trackDailySetComplete(locale);
    }
    const stats = loadPlayerStats();
    setPlan({
      next: nextDailyGame(game, done),
      deadline: start.getTime() + secondsUntilNextDaily(start) * 1000,
      setComplete,
      setsCompleted: stats.dailySetsCompleted,
      setShareText: setComplete ? buildDailySetShareText(today, locale) : null,
      setJustRecorded,
    });
    setNow(start.getTime());
    window.dispatchEvent(new CustomEvent(DAILY_DONE_EVENT, { detail: game }));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [game, locale, shareText]);

  if (!plan) return <div class="daily-next" data-testid="daily-next" />;

  const secondsLeft = Math.ceil((plan.deadline - now) / 1000);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div class="daily-next" data-testid="daily-next">
      {secondsLeft > 0 ? (
        <p class="daily-next-countdown" aria-live="off">{messages.dailyNextIn(formatCountdown(secondsLeft))}</p>
      ) : (
        <p class="daily-next-countdown">
          {messages.dailyNextReady}{" "}
          <button type="button" class="btn btn-secondary" onClick={() => window.location.reload()}>
            {messages.dailyNextReload}
          </button>
        </p>
      )}
      {plan.next ? (
        <a class="btn btn-secondary daily-next-link" href={`${base}${dailyGamePath(plan.next, locale)}`}>
          {messages.dailyNextGame(seoGameName(plan.next, messages))}
          <span aria-hidden="true"> →</span>
        </a>
      ) : (
        <div class="daily-set-complete" data-testid="daily-set-complete">
          <h3 id={titleId} class="result-title daily-set-title" data-feedback="result">
            {messages.dailySetCompleteTitle}
          </h3>
          <p class="daily-next-done">{messages.dailyAllDone}</p>
          <p class="daily-set-body">{messages.dailySetCompleteBody(plan.setsCompleted)}</p>
          {plan.setShareText ? (
            <div class="daily-set-share">
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => {
                  void handleShare(plan.setShareText!);
                }}
              >
                {copied ? messages.copiedToClipboard : messages.dailySetShare}
              </button>
              {shareFailed ? <p class="share-failed" role="status">{messages.shareFailed}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
