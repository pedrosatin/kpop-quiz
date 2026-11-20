import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { IntersectionGrid } from "../../lib/quiz-types";
import { useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { gridDailyRound, gridMatchId, isGridWin } from "./useGridGame";

const today = "2026-11-14";

function board(gridId: string, referenceDate = today): IntersectionGrid {
  return { grid_id: gridId, reference_date: referenceDate } as IntersectionGrid;
}

describe("gridMatchId", () => {
  it("names the match after the grid's date, or its id when the date is empty", () => {
    expect(gridMatchId(board("g1"))).toBe(`grid-${today}`);
    expect(gridMatchId(board("g1", ""))).toBe("grid-g1");
  });
});

describe("isGridWin", () => {
  it("wins with five squares or more", () => {
    expect(isGridWin(4)).toBe(false);
    expect(isGridWin(5)).toBe(true);
  });
});

describe("gridDailyRound", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("dates the round with the grid's reference date", () => {
    expect(gridDailyRound(board("g1"))).toEqual({ matchId: `grid-${today}`, date: today });
  });

  it("dates a grid with no date today", () => {
    expect(gridDailyRound(board("g1", ""))).toEqual({ matchId: "grid-g1", date: today });
  });

  // The grid loader never notes a board as stale; gridDailyRound skips that check.
  it("still dates a grid noted as served after its day", () => {
    const grid = noteDailyBoard(board("g1", "2026-11-13"), "2026-11-13", today);
    expect(gridDailyRound(grid)).toEqual({ matchId: "grid-2026-11-13", date: "2026-11-13" });
  });
});

// Same call shape as IntersectionGridContent.
describe("useRecordDailyMatch for the grid", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("counts a win with five or more solved cells", () => {
    const grid = board("g1");
    const gaveUp = false;
    const solvedCount = 5;
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(grid), true, !gaveUp && isGridWin(solvedCount)),
    );
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${today}`]);
  });

  it("counts a give-up as played without a win, whatever was solved", () => {
    const grid = board("g1");
    const gaveUp = true;
    const solvedCount = 9;
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(grid), true, !gaveUp && isGridWin(solvedCount)),
    );
    expect(gameCounts("grid")).toEqual({ played: 1, won: 0 });
  });

  it("counts a grid even when it is noted as served after its day", () => {
    const grid = noteDailyBoard(board("g1", "2026-11-13"), "2026-11-13", today);
    const gaveUp = false;
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(grid), true, !gaveUp && isGridWin(9)),
    );
    expect(gameCounts("grid")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-grid-daily-2026-11-13"]);
  });

  it("counts a grid with no date under today's marker", () => {
    const grid = board("g1", "");
    const gaveUp = false;
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(grid), true, !gaveUp && isGridWin(9)),
    );
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${today}`]);
  });
});
