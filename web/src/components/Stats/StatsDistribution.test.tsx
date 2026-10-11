import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { StatsDistribution } from "./StatsDistribution";
import type { PlayerStats } from "../../lib/player-stats";

const sampleStats: PlayerStats = {
  version: 1,
  overall: {
    played: 10,
    won: 8,
    currentStreak: 4,
    maxStreak: 6,
    lastPlayedDate: "2026-09-18",
  },
  games: {
    "name-guess": {
      played: 10,
      won: 9,
      currentStreak: 2,
      maxStreak: 5,
      lastPlayedDate: "2026-09-18",
      guessDistribution: { 1: 0, 2: 1, 3: 4, 4: 2, 5: 1, 6: 1 },
    },
  },
};

const emptyStats: PlayerStats = {
  version: 1,
  overall: {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: "2026-09-18",
  },
  games: {
    "name-guess": {
      played: 0,
      won: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastPlayedDate: "2026-09-18",
      guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    },
  },
};

const missingGameStats: PlayerStats = {
  version: 1,
  overall: {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: "2026-09-18",
  },
  games: {},
};

describe("StatsDistribution component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with typical guess distribution", () => {
    const { container } = render(
      <StatsDistribution stats={sampleStats} locale="pt-BR" />
    );

    // Check title
    expect(screen.getByText("Palpites por partida")).toBeInTheDocument();

    // Verify rows 1 through 6 exist inside the chart
    const chart = container.querySelector(".stats-distribution-chart");
    expect(chart).toBeInTheDocument();

    for (let i = 1; i <= 6; i++) {
      const attemptLabel = screen.getByText(i.toString(), { selector: '.stats-attempt-num' });
      expect(attemptLabel).toBeInTheDocument();
    }

    // Check specific counts are rendered correctly
    // guessDistribution: { 1: 0, 2: 1, 3: 4, 4: 2, 5: 1, 6: 1 }
    const row2Count = container.querySelectorAll('.stats-bar-count')[1];
    expect(row2Count.textContent).toBe('1');

    const row3Count = container.querySelectorAll('.stats-bar-count')[2];
    expect(row3Count.textContent).toBe('4');

    // Verify width calculation
    // Max is 4. For attempt 3 (count 4), pct should be (4/4)*100 = 100%
    const row3Fill = container.querySelectorAll('.stats-bar-fill')[2] as HTMLElement;
    expect(row3Fill.style.width).toBe('100%');
    expect(row3Fill).toHaveClass('has-count');

    // For attempt 1 (count 0), pct is Math.max(0, 7) = 7%
    const row1Fill = container.querySelectorAll('.stats-bar-fill')[0] as HTMLElement;
    expect(row1Fill.style.width).toBe('7%');
    expect(row1Fill).not.toHaveClass('has-count');
  });

  it("handles empty guess distribution gracefully", () => {
    const { container } = render(
      <StatsDistribution stats={emptyStats} locale="pt-BR" />
    );

    for (let i = 0; i < 6; i++) {
      const fill = container.querySelectorAll('.stats-bar-fill')[i] as HTMLElement;
      expect(fill.style.width).toBe('7%');
      expect(fill).not.toHaveClass('has-count');

      const count = container.querySelectorAll('.stats-bar-count')[i];
      expect(count.textContent).toBe('0');
    }
  });

  it("falls back to default distribution if game stats are missing", () => {
    const { container } = render(
      <StatsDistribution stats={missingGameStats} locale="pt-BR" />
    );

    for (let i = 0; i < 6; i++) {
      const fill = container.querySelectorAll('.stats-bar-fill')[i] as HTMLElement;
      expect(fill.style.width).toBe('7%');
      expect(fill).not.toHaveClass('has-count');

      const count = container.querySelectorAll('.stats-bar-count')[i];
      expect(count.textContent).toBe('0');
    }
  });
});
