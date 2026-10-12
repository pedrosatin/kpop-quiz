import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { StatsSummary, type StatsMetrics } from "./StatsSummary";
import { getMessages } from "../../i18n/catalog";

const sampleMetrics: StatsMetrics = {
  played: 42,
  winRate: 85,
  currentStreak: 5,
  maxStreak: 12,
};

describe("StatsSummary component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders metrics correctly in English", () => {
    const locale = "en";
    const messages = getMessages(locale);

    render(<StatsSummary metrics={sampleMetrics} locale={locale} />);

    // Verify values
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    // Verify labels in English
    expect(screen.getByText(messages.statsPlayed)).toBeInTheDocument();
    expect(screen.getByText(messages.statsWinRate)).toBeInTheDocument();
    expect(screen.getByText(messages.statsCurrentStreak)).toBeInTheDocument();
    expect(screen.getByText(messages.statsMaxStreak)).toBeInTheDocument();
  });

  it("renders metrics correctly in Portuguese", () => {
    const locale = "pt-BR";
    const messages = getMessages(locale);

    render(<StatsSummary metrics={sampleMetrics} locale={locale} />);

    // Verify values
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    // Verify labels in Portuguese
    expect(screen.getByText(messages.statsPlayed)).toBeInTheDocument();
    expect(screen.getByText(messages.statsWinRate)).toBeInTheDocument();
    expect(screen.getByText(messages.statsCurrentStreak)).toBeInTheDocument();
    expect(screen.getByText(messages.statsMaxStreak)).toBeInTheDocument();
  });

  it("handles zero values properly", () => {
    const zeroMetrics: StatsMetrics = {
      played: 0,
      winRate: 0,
      currentStreak: 0,
      maxStreak: 0,
    };

    render(<StatsSummary metrics={zeroMetrics} locale="en" />);

    // Verify we have enough "0" values rendered
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(3); // played, currentStreak, maxStreak

    // winRate should be 0%
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
