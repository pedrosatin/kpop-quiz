import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteDailyBoard } from "../data/daily-artifact";
import { loadPlayerStats } from "./player-stats";
import { gameCounts, matchMarkers } from "../test/match-records";
import { dailyBoardRound, useRecordDailyMatch, type DailyRound } from "./use-record-daily-match";

const today = "2026-11-14";

interface Props {
  round: DailyRound | null;
  finished: boolean;
  won: boolean;
}

function renderRecord(initialProps: Props) {
  return renderHook((props: Props) => useRecordDailyMatch("code", props.round, props.finished, props.won), {
    initialProps,
  });
}

describe("dailyBoardRound", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("dates the round with the board's reference date", () => {
    expect(dailyBoardRound({ reference_date: "2026-11-15" }, "code-p1")).toEqual({ matchId: "code-p1", date: "2026-11-15" });
  });

  it("dates a board with no date today", () => {
    expect(dailyBoardRound({ reference_date: "" }, "code-p1")).toEqual({ matchId: "code-p1", date: today });
  });

  it("has no round for a board the loader served after its day", () => {
    const board = noteDailyBoard({ reference_date: "2026-11-13" }, "2026-11-13", today);
    expect(dailyBoardRound(board, "code-p1")).toBeNull();
  });
});

describe("useRecordDailyMatch with dailyBoardRound", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T15:00:00Z`));
  });
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  // End-to-end: board.reference_date reaches the daily marker (DailyNext depends on it).
  it("records the marker from board.reference_date through dailyBoardRound", () => {
    renderRecord({
      round: dailyBoardRound({ reference_date: "2026-11-15" }, "code-p1"),
      finished: true,
      won: true,
    });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-code-daily-2026-11-15"]);
  });

  it("records today's marker when the board has no reference_date", () => {
    renderRecord({
      round: dailyBoardRound({ reference_date: "" }, "code-p1"),
      finished: true,
      won: true,
    });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);
  });
});

describe("useRecordDailyMatch", () => {
  const round: DailyRound = { matchId: "code-p1", date: today };

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("records a finished round once, with the outcome it finished with", () => {
    const { rerender } = renderRecord({ round, finished: false, won: false });
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });

    rerender({ round, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);

    rerender({ round: { ...round }, finished: true, won: false });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
  });

  it("counts a game restored already finished on the first load that finds it uncounted", () => {
    renderRecord({ round, finished: true, won: false }).unmount();
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });

    renderRecord({ round, finished: true, won: false });
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a restarted board finished again", () => {
    const { rerender } = renderRecord({ round, finished: true, won: false });
    rerender({ round, finished: false, won: false });
    rerender({ round, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
  });

  it("does not count another board for the same date", () => {
    const { rerender } = renderRecord({ round, finished: true, won: true });
    rerender({ round: { matchId: "code-p2", date: today }, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);
  });

  it("counts a board for another date on its own", () => {
    const { rerender } = renderRecord({ round, finished: true, won: true });
    rerender({ round: { matchId: "code-p2", date: "2026-11-15" }, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 2, won: 2 });
    expect(matchMarkers()).toEqual([
      `kpop-match-recorded-code-daily-${today}`,
      "kpop-match-recorded-code-daily-2026-11-15",
    ]);
  });

  it("counts a finished loss as played without a win", () => {
    renderRecord({ round, finished: true, won: false });
    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-code-daily-${today}`]);
  });

  it("does not count a round already counted under its legacy match id", () => {
    localStorage.setItem("kpop-match-recorded-code-code-p1", "1");
    renderRecord({ round, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
  });

  it("does not count the round again on a rerender when its marker cannot be stored", () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith("kpop-match-recorded-")) throw new DOMException("Storage is full", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    const { rerender } = renderRecord({ round, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([]);

    rerender({ round, finished: true, won: false });
    expect(gameCounts("code")).toEqual({ played: 1, won: 1 });
  });

  it("does not count a restarted board finished again when its marker cannot be stored", () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith("kpop-match-recorded-")) throw new DOMException("Storage is full", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    const { rerender } = renderRecord({ round, finished: true, won: false });
    rerender({ round, finished: false, won: false });
    rerender({ round, finished: true, won: true });

    expect(gameCounts("code")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });

  it("keeps the guess count of a win in the Name game's distribution", () => {
    renderHook(() => useRecordDailyMatch("name-guess", round, true, true, 3));
    expect(loadPlayerStats().games["name-guess"].guessDistribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0 });
  });

  // Map replay (`mapDailyRound` → null) and a missing board both pass null.
  it("counts nothing without a round", () => {
    renderRecord({ round: null, finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });

  it("counts nothing for a board the loader served after its day", () => {
    const stale = noteDailyBoard({ reference_date: "2026-11-13" }, "2026-11-13", today);
    renderRecord({ round: dailyBoardRound(stale, "code-p1"), finished: true, won: true });
    expect(gameCounts("code")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });

  // Quiz free play: round with matchId and no date (session-<id>).
  it("counts a finished free-play round under its match id with no daily date", () => {
    renderHook(() => useRecordDailyMatch("quiz", { matchId: "session-s1" }, true, false));
    expect(gameCounts("quiz")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual(["kpop-match-recorded-quiz-session-s1"]);
    expect(loadPlayerStats().games.quiz.lastPlayedDate).toBeUndefined();
  });
});
