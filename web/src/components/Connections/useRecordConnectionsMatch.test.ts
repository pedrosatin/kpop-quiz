import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import type { ConnectionsGameStatus } from "./types";
import { connectionsMatchId, useRecordConnectionsMatch } from "./useRecordConnectionsMatch";

const today = "2026-11-14";

function board(puzzleId: string, referenceDate = today): ConnectionsPuzzle {
  return { puzzle_id: puzzleId, reference_date: referenceDate } as ConnectionsPuzzle;
}

function renderRecord(puzzle: ConnectionsPuzzle, gameStatus: ConnectionsGameStatus) {
  return renderHook(
    (props) => useRecordConnectionsMatch(props.puzzle, props.gameStatus, props.gameStatus !== "in_progress"),
    { initialProps: { puzzle, gameStatus } },
  );
}

describe("useRecordConnectionsMatch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("names the match after the puzzle id", () => {
    expect(connectionsMatchId(board("p1"))).toBe("connections-p1");
  });

  it("counts the match once when it finishes, under the date's marker", () => {
    const puzzle = board("p1");
    const { rerender } = renderRecord(puzzle, "in_progress");
    expect(gameCounts("connections")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    rerender({ puzzle, gameStatus: "won" });
    expect(gameCounts("connections")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-connections-daily-${today}`]);

    rerender({ puzzle, gameStatus: "lost" });
    expect(gameCounts("connections")).toEqual({ played: 1, won: 1 });
  });

  it("counts a lost game as played without a win", () => {
    renderRecord(board("p1"), "lost");
    expect(gameCounts("connections")).toEqual({ played: 1, won: 0 });
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted", () => {
    const puzzle = board("p1");
    renderRecord(puzzle, "won").unmount();
    expect(gameCounts("connections")).toEqual({ played: 1, won: 1 });
    renderRecord(puzzle, "won");
    expect(gameCounts("connections")).toEqual({ played: 1, won: 1 });
  });

  it("does not count a restarted board finished again", () => {
    const puzzle = board("p1");
    const { rerender } = renderRecord(puzzle, "lost");
    rerender({ puzzle, gameStatus: "in_progress" });
    rerender({ puzzle, gameStatus: "won" });
    expect(gameCounts("connections")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a match already counted under the legacy per-board marker", () => {
    localStorage.setItem("kpop-match-recorded-connections-connections-p1", "1");
    renderRecord(board("p1"), "won");
    expect(gameCounts("connections")).toEqual({ played: 0, won: 0 });
  });

  it("does not count another board for the same date", () => {
    const { rerender } = renderRecord(board("p1"), "won");
    rerender({ puzzle: board("p2"), gameStatus: "won" });
    expect(gameCounts("connections")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-connections-daily-${today}`]);
  });

  it("counts nothing for a board the loader served after its day", () => {
    const puzzle = noteDailyBoard(board("p1", "2026-11-13"), "2026-11-13", today);
    renderRecord(puzzle, "won");
    expect(gameCounts("connections")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });
});
