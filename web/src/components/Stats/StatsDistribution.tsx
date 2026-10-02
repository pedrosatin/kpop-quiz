import { useMemo } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import type { PlayerStats } from "../../lib/player-stats";

export interface StatsDistributionProps {
  stats: PlayerStats;
  locale: Locale;
}

export function StatsDistribution({ stats, locale }: StatsDistributionProps) {
  const messages = getMessages(locale);

  const guessDistribution = useMemo(() => {
    return (
      stats.games["name-guess"]?.guessDistribution || {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
      }
    );
  }, [stats]);

  const maxGuessCount = useMemo(() => {
    const values = Object.values(guessDistribution);
    return Math.max(...values, 1);
  }, [guessDistribution]);

  return (
    <div class="stats-distribution-section" aria-label={messages.statsGuessDistribution}>
      <h3 class="stats-distribution-title">{messages.statsGuessDistribution}</h3>
      <div class="stats-distribution-chart" role="img" aria-label={messages.statsGuessDistribution}>
        {[1, 2, 3, 4, 5, 6].map((attempt) => {
          const count = guessDistribution[attempt] || 0;
          const pct = Math.max(Math.round((count / maxGuessCount) * 100), 7);
          return (
            <div key={attempt} class="stats-distribution-row">
              <span class="stats-attempt-num">{attempt}</span>
              <div class="stats-bar-track">
                <div
                  class={`stats-bar-fill ${count > 0 ? "has-count" : ""}`}
                  style={{ width: `${pct}%` }}
                  aria-label={`${attempt}: ${count}`}
                >
                  <span class="stats-bar-count">{count}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
