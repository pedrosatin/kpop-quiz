import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNext } from "./DailyNext";
import { rememberDailySetLine } from "../../lib/daily-set";
import { DAILY_DONE_EVENT, DAILY_GAMES, statsGameId } from "../../lib/daily-progress";
import { ALL_GAME_IDS, loadPlayerStats, recordGameFinish } from "../../lib/player-stats";
import { mapPilotStorageKey } from "../MapPilot/map-pilot-save";

// 23:59:58 in Sao Paulo on 2026-11-10.
const NOW = new Date("2026-11-11T02:59:58Z");
const TODAY = "2026-11-10";
const SHARE = "Cruzadinha\nhttps://kpopquiz.online/pt-br/?s=crossword";

function finishAllBut(gameId: (typeof ALL_GAME_IDS)[number], date: string): void {
  for (const id of ALL_GAME_IDS.filter((id) => id !== gameId)) {
    recordGameFinish(id, true, date);
  }
  if (gameId !== "map") {
    localStorage.setItem(
      mapPilotStorageKey(date),
      JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }),
    );
  }
}

function rememberLinesExcept(gameId: (typeof ALL_GAME_IDS)[number], date: string): void {
  for (const key of DAILY_GAMES) {
    const id = statsGameId(key);
    if (id === gameId) continue;
    rememberDailySetLine(date, id, `K-pop Quiz · ${key}\nline\nhttps://kpopquiz.online/pt-br/?s=quiz`);
  }
}

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

  it("celebrates the set when every daily game is finished today, without an X/9 counter", () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true, TODAY);
    localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }));
    render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
    expect(screen.getByTestId("daily-set-complete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toHaveAttribute("data-feedback", "result");
    expect(screen.getByText("Você concluiu todos os jogos de hoje.")).toBeInTheDocument();
    expect(screen.getByText("1 set completo nas estatísticas.")).toBeInTheDocument();
    expect(screen.queryByText(/\/9/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("celebrates only on the visit that records the set; later visits stay neutral", () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true, TODAY);
    localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }));
    rememberLinesExcept("crossword", TODAY);

    const first = render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />,
    );
    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
    first.unmount();

    render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
    expect(screen.queryByRole("heading", { name: "Set do dia completo" })).toBeNull();
    expect(document.querySelector('[data-feedback="result"]')).toBeNull();
    expect(screen.getByText("Você concluiu todos os jogos de hoje.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
  });

  it("offers the day share on the ninth game before its match is flushed", () => {
    finishAllBut("crossword", TODAY);
    rememberLinesExcept("crossword", TODAY);
    render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />,
    );
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toBeInTheDocument();
  });

  it("counts and celebrates the board date when the clock has crossed Sao Paulo midnight", () => {
    // 00:01 on 2026-11-21 in America/Sao_Paulo.
    vi.setSystemTime(new Date("2026-11-21T03:01:00Z"));
    const boardDate = "2026-11-20";
    finishAllBut("crossword", boardDate);
    rememberLinesExcept("crossword", boardDate);

    render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={boardDate} />,
    );

    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(loadPlayerStats().lastDailySetDate).toBe(boardDate);
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
  });

  it("tells the tabs that the game is done", () => {
    const done = vi.fn();
    window.addEventListener(DAILY_DONE_EVENT, done);
    render(<DailyNext game="timeline" locale="pt-BR" />);
    window.removeEventListener(DAILY_DONE_EVENT, done);
    expect((done.mock.calls[0]![0] as CustomEvent).detail).toBe("timeline");
  });
});
