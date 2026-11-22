import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { IntersectionGrid } from "../../lib/quiz-types";
import { loadPlayerStats, recordGameFinish, recordMatchOnce } from "../../lib/player-stats";
import { useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { completedDailyGames } from "../../lib/daily-progress";
import { gameCounts, matchMarkers } from "../../test/match-records";
import {
  gridChallengeDate,
  gridDailyRound,
  gridMatchId,
  gridStorageKey,
  isGridWin,
} from "./useGridGame";
import { gridShareText } from "./GridResults";
import { getMessages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";
import publication13 from "../../tests/fixtures/grid-publication.2026-11-13.json";
import reusedGridJson from "../../tests/fixtures/grid.reused-20261112.json";

const today = "2026-11-14";
const reuseDay = publication13.reference_date; // 2026-11-13
const originDay = publication13.grid_reference_date!; // 2026-11-12
const reusedGrid = reusedGridJson as unknown as IntersectionGrid;

function board(gridId: string, referenceDate = today): IntersectionGrid {
  return { grid_id: gridId, reference_date: referenceDate } as IntersectionGrid;
}

describe("gridMatchId", () => {
  it("names the match after the challenge date, or its id when the date is empty", () => {
    expect(gridMatchId(board("g1"))).toBe(`grid-${today}`);
    expect(gridMatchId(board("g1", ""))).toBe("grid-g1");
  });

  it("names a reused board after the publication day", () => {
    expect(gridMatchId(reusedGrid, reuseDay)).toBe(`grid-${reuseDay}`);
  });
});

describe("gridStorageKey", () => {
  it("keeps the legacy key when the board day is the challenge day", () => {
    expect(gridStorageKey(board("g1", today), today)).toBe("kpop-grid-g1");
  });

  it("dates the key when the board is reused on a later day", () => {
    expect(gridStorageKey(reusedGrid, reuseDay)).toBe(`kpop-grid-${reusedGrid.grid_id}-${reuseDay}`);
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

  it("dates the round with the grid's reference date when no challenge date is given", () => {
    expect(gridDailyRound(board("g1"))).toEqual({ matchId: `grid-${today}`, date: today });
  });

  it("dates a grid with no date today", () => {
    expect(gridDailyRound(board("g1", ""))).toEqual({ matchId: "grid-g1", date: today });
  });

  // The grid loader never notes a board as stale; gridDailyRound skips that check.
  it("still dates a grid noted as served after its day when no challenge date is given", () => {
    const grid = noteDailyBoard(board("g1", "2026-11-13"), "2026-11-13", today);
    expect(gridDailyRound(grid)).toEqual({ matchId: "grid-2026-11-13", date: "2026-11-13" });
  });

  it("dates a reused board with the publication day (ADR 047)", () => {
    expect(gridChallengeDate(reusedGrid, reuseDay)).toBe(reuseDay);
    expect(gridDailyRound(reusedGrid, reuseDay)).toEqual({
      matchId: `grid-${reuseDay}`,
      date: reuseDay,
    });
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

/**
 * Acceptance cases for a Grade reused from an earlier day (real publication
 * of 2026-11-13 reusing the board of 2026-11-12, ADR 047).
 */
describe("reused Grade of 2026-11-13 (publication fixture)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${reuseDay}T15:00:00-03:00`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("keeps the real publication identity of 13/11", () => {
    expect(publication13.schema_version).toBe("kpop-grid-publication-v1");
    expect(publication13.reference_date).toBe("2026-11-13");
    expect(publication13.grid_reference_date).toBe("2026-11-12");
    expect(publication13.grid_id).toBe(reusedGrid.grid_id);
    expect(reusedGrid.reference_date).toBe(originDay);
  });

  it("does not extend the streak over the missed origin day when the player finishes on the reuse day", () => {
    // Played connections on 11/11, missed 12/11, finishes the reused Grade on 13/11.
    recordGameFinish("connections", true, "2026-11-11");
    expect(loadPlayerStats().overall.currentStreak).toBe(1);

    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(reusedGrid, reuseDay), true, true),
    );

    const stats = loadPlayerStats();
    expect(stats.games.grid.lastPlayedDate).toBe(reuseDay);
    expect(stats.overall.lastPlayedDate).toBe(reuseDay);
    // Gap from 11/11 to 13/11 resets the overall streak to 1 (not 3 via 12/11).
    expect(stats.overall.currentStreak).toBe(1);
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${reuseDay}`]);
    expect(matchMarkers()).not.toContain(`kpop-match-recorded-grid-daily-${originDay}`);
  });

  it("does not change played when a finished origin-day save is opened on the reuse day without a new play", () => {
    const originKey = gridStorageKey(reusedGrid, originDay);
    expect(originKey).toBe(`kpop-grid-${reusedGrid.grid_id}`);
    const reuseKey = gridStorageKey(reusedGrid, reuseDay);
    expect(reuseKey).toBe(`kpop-grid-${reusedGrid.grid_id}-${reuseDay}`);

    // Finished the same board on 12/11 under the legacy key.
    const finishedCells: Record<string, { solved: boolean; failed: boolean; entityId: string }> = {};
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const entityId = reusedGrid.cells[r * 3 + c]!.valid_entity_ids[0];
        expect(entityId).toBeTruthy();
        finishedCells[`${r},${c}`] = { solved: true, failed: false, entityId: entityId! };
      }
    }
    localStorage.setItem(originKey, JSON.stringify({ guessesUsed: 9, cells: finishedCells }));
    recordMatchOnce("grid", `grid-${originDay}`, true, originDay);
    const playedBefore = loadPlayerStats().games.grid.played;

    // Opening 13/11 reads the dated key (empty), so the round is not finished
    // and useRecordDailyMatch must not run with finished=true.
    expect(localStorage.getItem(reuseKey)).toBeNull();
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(reusedGrid, reuseDay), false, false),
    );

    expect(loadPlayerStats().games.grid.played).toBe(playedBefore);
    expect(matchMarkers()).toEqual([`kpop-match-recorded-grid-daily-${originDay}`]);
    expect(completedDailyGames(reuseDay).has("grid")).toBe(false);
  });

  it("marks completedDailyGames for the reuse day after playing on that day", () => {
    renderHook(() =>
      useRecordDailyMatch("grid", gridDailyRound(reusedGrid, reuseDay), true, true),
    );
    expect(completedDailyGames(reuseDay).has("grid")).toBe(true);
    expect(completedDailyGames(originDay).has("grid")).toBe(false);
  });

  it("builds the share text with the publication day, not the board origin", () => {
    const states: Record<string, GridCellState> = {};
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        states[cellKey(r, c)] = { solved: false, failed: false };
      }
    }
    const text = gridShareText(reusedGrid, states, 1, false, getMessages("pt-BR"), "pt-BR", reuseDay);
    // Challenge # for 2026-11-13 from FIRST_DAILY_DATE.grid 2026-09-17.
    expect(text).toContain("K-pop Quiz #58 · Grade");
    expect(text).not.toContain("#57 ·"); // 2026-11-12 would be #57
    const originText = gridShareText(reusedGrid, states, 1, false, getMessages("en"), "en", originDay);
    expect(originText).toContain("K-pop Quiz #57 · Grid");
  });
});
