import { useMemo } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import type { PlayerStats } from "../../lib/player-stats";

export interface StatsDistributionProps {
  stats: PlayerStats;
  locale: Locale;
}

interface DistributionRow {
  key: string;
  label: string;
  /** Accessible name of the row, read in the chart's label. */
  name: string;
  count: number;
  isLoss: boolean;
}

const ATTEMPTS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Rows of the Name Guess chart: one per winning guess count, then the
 * losses. The stats keep no loss count of their own: every game played and
 * not won is a loss, so the row reads `played - won` and the stored format
 * stays as it is.
 */
export function distributionRows(stats: PlayerStats, lossName: string): DistributionRow[] {
  const game = stats.games["name-guess"];
  const distribution = game?.guessDistribution ?? {};
  const rows: DistributionRow[] = ATTEMPTS.map((attempt) => ({
    key: String(attempt),
    label: String(attempt),
    name: String(attempt),
    count: distribution[attempt] || 0,
    isLoss: false,
  }));
  const losses = Math.max((game?.played ?? 0) - (game?.won ?? 0), 0);
  rows.push({ key: "loss", label: "X", name: lossName, count: losses, isLoss: true });
  return rows;
}

export function StatsDistribution({ stats, locale }: StatsDistributionProps) {
  const messages = getMessages(locale);

  const rows = useMemo(() => distributionRows(stats, messages.statsLossRow), [stats, messages.statsLossRow]);
  const maxCount = Math.max(...rows.map((row) => row.count), 1);
  // role="img" hides the rows from assistive tech, so the label carries every count.
  const chartLabel = `${messages.statsGuessDistribution}: ${rows.map((row) => `${row.name}: ${row.count}`).join(", ")}`;

  return (
    <div class="stats-distribution-section">
      <h3 class="stats-distribution-title">{messages.statsGuessDistribution}</h3>
      <div class="stats-distribution-chart" role="img" aria-label={chartLabel}>
        {rows.map((row) => {
          const pct = Math.max(Math.round((row.count / maxCount) * 100), 7);
          const fillClass = ["stats-bar-fill", row.count > 0 ? "has-count" : "", row.isLoss ? "is-loss" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={row.key} class="stats-distribution-row">
              <span class="stats-attempt-num">{row.label}</span>
              <div class="stats-bar-track">
                <div class={fillClass} style={{ width: `${pct}%` }}>
                  <span class="stats-bar-count">{row.count}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
