import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsModal } from "./StatsModal";
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
    quiz: {
      played: 4,
      won: 4,
      currentStreak: 4,
      maxStreak: 4,
      lastPlayedDate: "2026-09-18",
    },
    grid: {
      played: 2,
      won: 1,
      currentStreak: 1,
      maxStreak: 1,
      lastPlayedDate: "2026-09-18",
    },
    connections: {
      played: 1,
      won: 1,
      currentStreak: 1,
      maxStreak: 1,
      lastPlayedDate: "2026-09-18",
    },
    "name-guess": {
      played: 2,
      won: 1,
      currentStreak: 0,
      maxStreak: 1,
      lastPlayedDate: "2026-09-18",
      guessDistribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0 },
    },
    "word-search": {
      played: 1,
      won: 1,
      currentStreak: 1,
      maxStreak: 1,
      lastPlayedDate: "2026-09-18",
    },
  },
};

describe("StatsModal component", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <StatsModal isOpen={false} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders with correct dialog accessibility attributes when open", () => {
    render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "stats-modal-title");
    expect(screen.getByText("Estatísticas do jogador")).toBeInTheDocument();
  });

  it("displays correct overall summary metrics", () => {
    render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );

    expect(screen.getByText("10")).toBeInTheDocument(); // Played
    expect(screen.getByText("80%")).toBeInTheDocument(); // Win rate (8/10)
    expect(screen.getByText(/4/)).toBeInTheDocument(); // Current streak
    expect(screen.getByText("6")).toBeInTheDocument(); // Max streak
  });

  it("switches tabs and updates metrics", () => {
    render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );

    const quizTab = screen.getByRole("tab", { name: "Quiz" });
    fireEvent.click(quizTab);

    expect(quizTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("100%")).toBeInTheDocument(); // Quiz win rate (4/4)
  });

  it("displays guess distribution chart on name-guess tab", () => {
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );

    const nameGuessTab = screen.getByRole("tab", { name: "Adivinhe" });
    fireEvent.click(nameGuessTab);

    expect(screen.getByText("Distribuição de tentativas")).toBeInTheDocument();
    const chart = container.querySelector(".stats-distribution-chart");
    expect(chart).toBeInTheDocument();
    // Verify rows 1 through 6 exist inside the chart
    for (let i = 1; i <= 6; i++) {
      const attemptLabel = chart?.querySelector(`.stats-attempt-num:nth-child(1)`);
      expect(attemptLabel).toBeInTheDocument();
    }
    const rows = container.querySelectorAll(".stats-distribution-row");
    expect(rows).toHaveLength(6);
  });

  it("triggers onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <StatsModal isOpen={true} onClose={onClose} locale="pt-BR" stats={sampleStats} />
    );

    const closeBtn = screen.getByRole("button", { name: "Fechar estatísticas" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("triggers onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <StatsModal isOpen={true} onClose={onClose} locale="pt-BR" stats={sampleStats} />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("triggers onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <StatsModal isOpen={true} onClose={onClose} locale="pt-BR" stats={sampleStats} />
    );

    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onClose when clicking inside the modal card", () => {
    const onClose = vi.fn();
    const { container } = render(
      <StatsModal isOpen={true} onClose={onClose} locale="pt-BR" stats={sampleStats} />
    );

    const card = container.querySelector(".modal-card") as HTMLElement;
    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders with zero violations in axe accessibility audit", async () => {
    const { container } = render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="pt-BR" stats={sampleStats} />
    );

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("renders correctly in English", () => {
    render(
      <StatsModal isOpen={true} onClose={vi.fn()} locale="en" stats={sampleStats} />
    );

    expect(screen.getByText("Player statistics")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close statistics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overall" })).toBeInTheDocument();
  });
});
