import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { GameNav, type GameNavItem } from "./GameNav";
import { dailyReferenceDate } from "../../data/daily-artifact";
import { DAILY_DONE_EVENT } from "../../lib/daily-progress";
import { recordGameFinish } from "../../lib/player-stats";

const games: GameNavItem[] = [
  { key: "quiz", label: "Quiz", href: "/pt-br/", isActive: false },
  { key: "grid", label: "Grade", href: "/pt-br/grid/", isActive: true },
  { key: "connections", label: "Conexões", href: "/pt-br/conexoes/", isActive: false },
];

describe("GameNav", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("marks the games finished today with a check and hidden text", () => {
    recordGameFinish("connections", false, dailyReferenceDate());
    recordGameFinish("quiz", true, "2020-01-01");
    render(<GameNav games={games} locale="pt-BR" />);

    expect(screen.getByRole("link", { name: "Conexões concluído hoje" })).toHaveAttribute("href", "/pt-br/conexoes/");
    expect(screen.getByRole("link", { name: "Quiz" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grade" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("game-nav-done-connections").querySelector('[aria-hidden="true"]')).toHaveTextContent("✓");
  });

  it("marks the game whose result just showed", () => {
    render(<GameNav games={games} locale="en" />);
    act(() => {
      window.dispatchEvent(new CustomEvent(DAILY_DONE_EVENT, { detail: "grid" }));
    });
    expect(screen.getByRole("link", { name: "Grade done today" })).toBeInTheDocument();
  });
});
