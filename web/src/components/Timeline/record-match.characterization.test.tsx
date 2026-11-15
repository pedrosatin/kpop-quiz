import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../tests/fixtures/timeline.daily.json";
import { PLAYER_STATS_STORAGE_KEY } from "../../lib/player-stats";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { dayAfter, onDay, resetStaleDaily, serveDailyBoard } from "../../test/stale-daily";
import { TimelineGame } from "./TimelineGame";
import { getCanonicalChronologicalOrder } from "./timeline-utils";
import { timelineMatchId } from "./useTimelineGame";

// Pins how a Timeline round reaches the player stats: the match id, the
// marker it leaves and which rounds count (ADR 030).

const puzzle = fixture as unknown as TimelinePuzzle;
const saveKey = `kpop-timeline-${puzzle.puzzle_id}`;
const dailyMarker = `kpop-match-recorded-timeline-daily-${puzzle.reference_date}`;
const canonicalIds = getCanonicalChronologicalOrder(puzzle.events).map((event) => event.id);

/** A board in progress, already in the canonical order. */
function storeSolvedDraft() {
  localStorage.setItem(saveKey, JSON.stringify({
    puzzleId: puzzle.puzzle_id,
    referenceDate: puzzle.reference_date,
    orderedEventIds: canonicalIds,
    submitted: false,
  }));
}

async function submit(heading: RegExp | string = /Pontuação:/) {
  fireEvent.click(screen.getByRole("button", { name: "Verificar ordem" }));
  await screen.findByRole("heading", { name: heading });
}

async function giveUp() {
  fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
  await screen.findByRole("heading", { name: "Você desistiu" });
}

describe("Timeline match record", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    cleanup();
    resetStaleDaily();
    vi.restoreAllMocks();
  });

  it("names the match after the puzzle id", () => {
    expect(timelineMatchId(puzzle)).toBe(`timeline-${puzzle.puzzle_id}`);
  });

  it("counts the canonical order as a win once, under the marker of the board's date", async () => {
    storeSolvedDraft();
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    expect(gameCounts("timeline")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    await submit(/Pontuação:\s*5\/5/);
    expect(gameCounts("timeline")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a partial score as played without a win", async () => {
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await submit();
    expect(gameCounts("timeline")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a give-up on the canonical order as played without a win", async () => {
    storeSolvedDraft();
    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await giveUp();
    expect(gameCounts("timeline")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted", async () => {
    storeSolvedDraft();
    const first = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await submit(/Pontuação:\s*5\/5/);
    first.unmount();
    localStorage.removeItem(PLAYER_STATS_STORAGE_KEY);
    localStorage.removeItem(dailyMarker);

    const second = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await screen.findByRole("heading", { name: /Pontuação:\s*5\/5/ });
    expect(gameCounts("timeline")).toEqual({ played: 1, won: 1 });
    second.unmount();

    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await screen.findByRole("heading", { name: /Pontuação:\s*5\/5/ });
    expect(gameCounts("timeline")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("does not count a restored game already counted under the legacy per-board marker", async () => {
    const first = render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await submit();
    first.unmount();
    localStorage.removeItem(PLAYER_STATS_STORAGE_KEY);
    localStorage.removeItem(dailyMarker);
    localStorage.setItem(`kpop-match-recorded-timeline-timeline-${puzzle.puzzle_id}`, "1");

    render(<TimelineGame locale="pt-BR" puzzle={puzzle} />);
    await screen.findByRole("heading", { name: /Pontuação:/ });
    expect(gameCounts("timeline")).toEqual({ played: 0, won: 0 });
  });

  it("counts nothing for a board the loader served after its day", async () => {
    onDay(dayAfter(puzzle.reference_date));
    serveDailyBoard(puzzle);
    render(<TimelineGame locale="pt-BR" />);
    await screen.findByRole("button", { name: "Verificar ordem" });
    await submit();
    expect(screen.getByTestId("stale-daily-notice")).toBeInTheDocument();
    expect(gameCounts("timeline")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });
});
