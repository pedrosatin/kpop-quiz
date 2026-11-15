import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { CodeGroupsPuzzle } from "../../data/code-groups";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { codeGroupsMatchId, useRecordCodeGroupsMatch } from "./useRecordCodeGroupsMatch";

const today = "2026-11-14";

function board(puzzleId: string, referenceDate = today): CodeGroupsPuzzle {
  return { puzzle_id: puzzleId, reference_date: referenceDate } as CodeGroupsPuzzle;
}

function renderRecord(puzzle: CodeGroupsPuzzle, isFinished: boolean, isWin: boolean) {
  return renderHook((props) => useRecordCodeGroupsMatch(props.puzzle, props.isFinished, props.isWin), {
    initialProps: { puzzle, isFinished, isWin },
  });
}

describe("useRecordCodeGroupsMatch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("names the match after the puzzle id", () => {
    expect(codeGroupsMatchId(board("p1"))).toBe("code-p1");
  });

  it("counts the match once when it finishes, under the date's marker", () => {
    const puzzle = board("p1");
    const { rerender } = renderRecord(puzzle, false, false);
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    rerender({ puzzle, isFinished: true, isWin: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);

    rerender({ puzzle, isFinished: true, isWin: false });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted", () => {
    const puzzle = board("p1");
    renderRecord(puzzle, true, false).unmount();
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
    renderRecord(puzzle, true, false);
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a restarted board finished again", () => {
    const puzzle = board("p1");
    const { rerender } = renderRecord(puzzle, true, true);
    rerender({ puzzle, isFinished: false, isWin: false });
    rerender({ puzzle, isFinished: true, isWin: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
  });

  it("does not count a match already counted under the legacy per-board marker", () => {
    localStorage.setItem("kpop-match-recorded-code-code-p1", "1");
    renderRecord(board("p1"), true, true);
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
  });

  it("does not count another board for the same date", () => {
    const { rerender } = renderRecord(board("p1"), true, true);
    rerender({ puzzle: board("p2"), isFinished: true, isWin: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);
  });

  it("counts nothing for a board the loader served after its day", () => {
    const puzzle = noteDailyBoard(board("p1", "2026-11-13"), "2026-11-13", today);
    renderRecord(puzzle, true, true);
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });
});
