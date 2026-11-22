import { act, cleanup, render, screen, waitFor } from "@testing-library/preact";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNext } from "./DailyNext";
import { rememberDailySetLine } from "../../lib/daily-set";
import { DAILY_DONE_EVENT, DAILY_GAMES, statsGameId } from "../../lib/daily-progress";
import { ALL_GAME_IDS, loadPlayerStats, recordGameFinish } from "../../lib/player-stats";
import { mapPilotStorageKey } from "../MapPilot/map-pilot-save";
import { setGameAnalyticsConsent } from "../../lib/game-analytics";
import { DAILY_SET_VERSION } from "../../data/daily-set-loader";

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

function stubDailySet(omitted: Record<string, string> = {}, referenceDate = TODAY): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("daily-set.json")) {
        return new Response(
          JSON.stringify({
            schema_version: DAILY_SET_VERSION,
            reference_date: referenceDate,
            omitted,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }),
  );
}

describe("DailyNext", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    stubDailySet();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("counts down every second without announcing it, then offers a reload", async () => {
    render(<DailyNext game="grid" locale="pt-BR" />);
    expect(await screen.findByText("Novo desafio em 00:00:02")).toHaveAttribute("aria-live", "off");

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

  it("links the first game in tab order not finished today", async () => {
    recordGameFinish("quiz", false, TODAY);
    render(<DailyNext game="grid" locale="en" />);
    expect(await screen.findByText("New puzzle in 00:00:02")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next: Connections" })).toHaveAttribute("href", "/en/connections/");
  });

  it("celebrates the set when every daily game is finished today, without an X/9 counter", async () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true, TODAY);
    localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }));
    render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
    expect(await screen.findByTestId("daily-set-complete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toHaveAttribute("data-feedback", "result");
    expect(screen.getByText("Você concluiu todos os jogos de hoje.")).toBeInTheDocument();
    expect(screen.getByText("1 set completo nas estatísticas.")).toBeInTheDocument();
    expect(screen.queryByText(/\/9/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the daily set completion when Strands is omitted and the rest are done", async () => {
    stubDailySet({ strands: "generation failed (ValueError)" });
    finishAllBut("strands", TODAY);
    rememberLinesExcept("strands", TODAY);
    render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
    expect(await screen.findByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);
    expect(screen.queryByRole("link", { name: /Strands|Palavras conectadas/ })).toBeNull();
  });

  it("celebrates only on the visit that records the set; later visits stay neutral", async () => {
    for (const id of ALL_GAME_IDS) recordGameFinish(id, true, TODAY);
    localStorage.setItem(mapPilotStorageKey(TODAY), JSON.stringify({ events: ["a"], answers: ["x"], index: 1 }));
    rememberLinesExcept("crossword", TODAY);

    const first = render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />,
    );
    expect(await screen.findByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
    first.unmount();

    render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
    expect(await screen.findByText("Você concluiu todos os jogos de hoje.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Set do dia completo" })).toBeNull();
    expect(document.querySelector('[data-feedback="result"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
  });

  it("keeps the celebration when the share text changes during the same visit", async () => {
    finishAllBut("crossword", TODAY);
    rememberLinesExcept("crossword", TODAY);
    const view = render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />,
    );
    expect(await screen.findByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );

    view.rerender(
      <DailyNext game="crossword" locale="pt-BR" shareText={`${SHARE}\nalto contraste`} referenceDate={TODAY} />,
    );
    expect(await screen.findByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);
  });

  it("reports the day share to GA4 as daily_set, not as the quiz result", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    vi.stubGlobal("navigator", { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn() } });
    setGameAnalyticsConsent("G-TEST", true);
    try {
      finishAllBut("crossword", TODAY);
      rememberLinesExcept("crossword", TODAY);
      render(<DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />);
      await screen.findByRole("button", { name: "Compartilhar o dia" });
      await act(async () => {
        screen.getByRole("button", { name: "Compartilhar o dia" }).click();
      });
      expect(gtag).toHaveBeenCalledWith(
        "event",
        "share",
        expect.objectContaining({ game: "daily_set", content_type: "daily_set", item_id: "daily_set" }),
      );
    } finally {
      setGameAnalyticsConsent("", false);
      vi.unstubAllGlobals();
    }
  });

  it("offers the day share on the ninth game before its match is flushed", async () => {
    finishAllBut("crossword", TODAY);
    rememberLinesExcept("crossword", TODAY);
    render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={TODAY} />,
    );
    expect(await screen.findByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set do dia completo" })).toBeInTheDocument();
  });

  it("counts and celebrates the board date when the clock has crossed Sao Paulo midnight", async () => {
    vi.setSystemTime(new Date("2026-11-21T03:01:00Z"));
    const boardDate = "2026-11-20";
    stubDailySet({}, boardDate);
    finishAllBut("crossword", boardDate);
    rememberLinesExcept("crossword", boardDate);

    render(
      <DailyNext game="crossword" locale="pt-BR" shareText={SHARE} referenceDate={boardDate} />,
    );

    expect(await screen.findByRole("heading", { name: "Set do dia completo" })).toHaveAttribute(
      "data-feedback",
      "result",
    );
    expect(loadPlayerStats().lastDailySetDate).toBe(boardDate);
    expect(loadPlayerStats().dailySetsCompleted).toBe(1);
    expect(screen.getByRole("button", { name: "Compartilhar o dia" })).toBeInTheDocument();
  });

  it("tells the tabs that the game is done", async () => {
    const done = vi.fn();
    window.addEventListener(DAILY_DONE_EVENT, done);
    render(<DailyNext game="timeline" locale="pt-BR" />);
    await waitFor(() => expect(done).toHaveBeenCalled());
    window.removeEventListener(DAILY_DONE_EVENT, done);
    expect((done.mock.calls[0]![0] as CustomEvent).detail).toBe("timeline");
  });
});
