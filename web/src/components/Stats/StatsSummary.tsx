import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";

export interface StatsMetrics {
  played: number;
  winRate: number;
  currentStreak: number;
  maxStreak: number;
}

export interface StatsSummaryProps {
  metrics: StatsMetrics;
  locale: Locale;
}

export function StatsSummary({ metrics, locale }: StatsSummaryProps) {
  const messages = getMessages(locale);
  return (
    <div class="result-stats stats-summary-grid">
      <div class="result-stat">
        <span class="result-stat-value">{metrics.played}</span>
        <span class="result-stat-label">{messages.statsPlayed}</span>
      </div>
      <div class="result-stat">
        <span class="result-stat-value">{metrics.winRate}%</span>
        <span class="result-stat-label">{messages.statsWinRate}</span>
      </div>
      <div class="result-stat">
        <span class="result-stat-value">{metrics.currentStreak}</span>
        <span class="result-stat-label">{messages.statsCurrentStreak}</span>
      </div>
      <div class="result-stat">
        <span class="result-stat-value">{metrics.maxStreak}</span>
        <span class="result-stat-label">{messages.statsMaxStreak}</span>
      </div>
    </div>
  );
}
