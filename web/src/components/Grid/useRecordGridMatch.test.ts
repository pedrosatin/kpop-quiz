import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { IntersectionGrid } from "../../lib/quiz-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import type { GridGameStatus } from "./types";
import { gridMatchId, isGridWin, useRecordGridMatch } from "./useRecordGridMatch";

const today = "2026-11-14";

function board(gridId: string, referenceDate = today): IntersectionGrid {
  return { grid_id: gridId, reference_date: referenceDate } as IntersectionGrid;
}

interface Props {
  grid: IntersectionGrid | null;
  status: GridGameStatus;
  solvedCount: number;
  gaveUp?: boolean;
}

function renderRecord(initialProps: Props) {
  return renderHook(
    (props: Props) => useRecordGridMatch(props.grid, props.status, props.solvedCount, props.gaveUp),
    { initialProps },
  );
}

describe("useRecordGridMatch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("names the match after the grid's date, or its id when the date is empty", () => {
    expect(gridMatchId(board("g1"))).toBe(`grid-${today}`);
    expect(gridMatchId(board("g1", ""))).toBe("grid-g1");
  });

  it("wins with five squares or more", () => {
    expect(isGridWin(4)).toBe(false);
    expect(isGridWin(5)).toBe(true);
  });

  it("counts the match once when it completes, under the date's marker", () => {
    const grid = board("g1");
    const { rerender } = renderRecord({ grid, status: "ready", solvedCount: 5 });
    expect(gameCounts("grid")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    rerender({ grid, status: "complete", solvedCount: 5 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${today}`]);

    rerender({ grid, status: "complete", solvedCount: 4 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
  });

  it("counts a give-up as played without a win, whatever was solved", () => {
    renderRecord({ grid: board("g1"), status: "complete", solvedCount: 9, gaveUp: true });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 0 });
  });

  it("counts nothing before the grid loads", () => {
    renderRecord({ grid: null, status: "complete", solvedCount: 9 });
    expect(gameCounts("grid")).toEqual({ played: 0, won: 0 });
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted", () => {
    const grid = board("g1");
    renderRecord({ grid, status: "complete", solvedCount: 3 }).unmount();
    expect(gameCounts("grid")).toEqual({ played: 1, won: 0 });
    renderRecord({ grid, status: "complete", solvedCount: 3 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a restarted board completed again", () => {
    const grid = board("g1");
    const { rerender } = renderRecord({ grid, status: "complete", solvedCount: 3 });
    rerender({ grid, status: "ready", solvedCount: 0 });
    rerender({ grid, status: "complete", solvedCount: 9 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a match already counted under the legacy per-board marker", () => {
    localStorage.setItem(`kpop-match-recorded-grid-grid-${today}`, "1");
    renderRecord({ grid: board("g1"), status: "complete", solvedCount: 9 });
    expect(gameCounts("grid")).toEqual({ played: 0, won: 0 });
  });

  it("does not count another grid for the same date", () => {
    const { rerender } = renderRecord({ grid: board("g1"), status: "complete", solvedCount: 9 });
    rerender({ grid: board("g2"), status: "complete", solvedCount: 9 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${today}`]);
  });

  it("counts a grid with no date under today's marker", () => {
    renderRecord({ grid: board("g1", ""), status: "complete", solvedCount: 9 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${today}`]);
  });

  // The grid loader never notes a board as stale; the hook does not check.
  it("counts a grid even when it is noted as served after its day", () => {
    const grid = noteDailyBoard(board("g1", "2026-11-13"), "2026-11-13", today);
    renderRecord({ grid, status: "complete", solvedCount: 9 });
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-grid-daily-2026-11-13"]);
  });
});
