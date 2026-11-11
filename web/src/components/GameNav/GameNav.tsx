import { useEffect, useState } from "preact/hooks";
import type { SeoRouteKey } from "../../i18n/catalog";
import { getMessages } from "../../i18n/catalog";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { completedDailyGames, DAILY_DONE_EVENT } from "../../lib/daily-progress";
import type { Locale } from "../../lib/quiz-types";

export interface GameNavItem {
  key: SeoRouteKey;
  label: string;
  href: string;
  isActive: boolean;
}

/**
 * The game tabs, with a ✓ on each game finished today. Progress lives in
 * localStorage, so the marks appear after hydration; the server HTML has none.
 */
export function GameNav({ games, locale }: { games: GameNavItem[]; locale: Locale }) {
  const messages = getMessages(locale);
  const [done, setDone] = useState<ReadonlySet<SeoRouteKey>>(new Set());

  useEffect(() => {
    setDone(completedDailyGames(dailyReferenceDate()));
    const markDone = (event: Event) => {
      const key = (event as CustomEvent<SeoRouteKey>).detail;
      setDone((current) => new Set(current).add(key));
    };
    window.addEventListener(DAILY_DONE_EVENT, markDone);
    return () => window.removeEventListener(DAILY_DONE_EVENT, markDone);
  }, []);

  return (
    <div class="game-nav-container">
      {games.map((game) => (
        <a
          key={game.key}
          href={game.href}
          class={`game-nav-item ${game.isActive ? "is-active" : ""}`}
          aria-current={game.isActive ? "page" : undefined}
        >
          {game.label}
          {/* The space keeps the hidden text apart from the label in the accessible name. */}
          {done.has(game.key) && (
            <>
              {" "}
              <span class="game-nav-done" data-testid={`game-nav-done-${game.key}`}>
                <span aria-hidden="true">✓</span>
                <span class="visually-hidden">{messages.gameNavDoneToday}</span>
              </span>
            </>
          )}
        </a>
      ))}
    </div>
  );
}
