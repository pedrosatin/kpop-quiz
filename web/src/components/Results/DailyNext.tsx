import { useEffect, useState } from "preact/hooks";
import type { SeoRouteKey } from "../../i18n/catalog";
import { getMessages } from "../../i18n/catalog";
import { dailyReferenceDate, secondsUntilNextDaily } from "../../data/daily-artifact";
import { completedDailyGames, DAILY_DONE_EVENT, dailyGamePath, formatCountdown, nextDailyGame } from "../../lib/daily-progress";
import type { Locale } from "../../lib/quiz-types";
import { seoGameName } from "../../lib/seo-routes";

interface Plan {
  next: SeoRouteKey | null;
  /** Epoch ms of the next midnight in Sao Paulo. */
  deadline: number;
}

/**
 * End of a daily game: time left until the next challenge and a link to
 * the next game not finished today. It reads the clock and storage only
 * after mounting, so the server and the first client render agree.
 */
export function DailyNext({ game, locale }: { game: SeoRouteKey; locale: Locale }) {
  const messages = getMessages(locale);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const start = new Date();
    setPlan({
      next: nextDailyGame(game, completedDailyGames(dailyReferenceDate(start))),
      deadline: start.getTime() + secondsUntilNextDaily(start) * 1000,
    });
    setNow(start.getTime());
    window.dispatchEvent(new CustomEvent(DAILY_DONE_EVENT, { detail: game }));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [game]);

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
        <p class="daily-next-done">{messages.dailyAllDone}</p>
      )}
    </div>
  );
}
