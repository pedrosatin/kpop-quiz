import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNext } from "./DailyNext";
import { DAILY_DONE_EVENT } from "../../lib/daily-progress";
import { ALL_GAME_IDS, recordGameFinish } from "../../lib/player-stats";
import { mapPilotStorageKey } from "../MapPilot/map-pilot-save";

// 23:59:58 in Sao Paulo on 2026-11-10.
const NOW = new Date("2026-11-11T02:59:58Z");
const TODAY = "2026-11-10";

describe("DailyNext", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("counts down every second without announcing it, then offers a reload", () => {
    render(<DailyNext game="grid" locale="pt-BR" />);
    expect(screen.getByText("Novo desafio em 00:00:02")).toHaveAttribute("aria-live", "off");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Novo desafio em 00:00:01")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/Novo desafio em/)).toBeNull();
    expect(screen.getByText(/O novo desafio já está disponível/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });

  it("links the first game in tab order not finished today", () => {
    recordGameFinish("quiz", false, TODAY);
    render(<DailyNext game="grid" locale="en" />);
    expect(screen.getByText("New puzzle in 00:00:02")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next: Connections" })).toHaveAttribute("href", "/en/connections/");
  });

  it("says so when every daily game is finished today", () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true, TODAY);
    localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }));
    render(<DailyNext game="crossword" locale="pt-BR" />);
    expect(screen.getByText("Você concluiu todos os jogos de hoje.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("tells the tabs that the game is done", () => {
    const done = vi.fn();
    window.addEventListener(DAILY_DONE_EVENT, done);
    render(<DailyNext game="timeline" locale="pt-BR" />);
    window.removeEventListener(DAILY_DONE_EVENT, done);
    expect((done.mock.calls[0]![0] as CustomEvent).detail).toBe("timeline");
  });
});
