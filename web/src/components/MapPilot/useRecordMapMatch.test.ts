import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { mapMatchId, useRecordMapMatch } from "./useRecordMapMatch";

const date = "2026-11-14";

interface Props {
  roundDate: string;
  isComplete: boolean;
  isWin: boolean;
  isReplay: boolean;
}

function renderRecord(initialProps: Props) {
  return renderHook(
    (props: Props) => useRecordMapMatch(props.roundDate, props.isComplete, props.isWin, props.isReplay),
    { initialProps },
  );
}

describe("useRecordMapMatch", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("names the match after the round date", () => {
    expect(mapMatchId(date)).toBe(`map-${date}`);
  });

  it("counts the round once when it completes, under the date's marker", () => {
    const { rerender } = renderRecord({ roundDate: date, isComplete: false, isWin: false, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    rerender({ roundDate: date, isComplete: true, isWin: true, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([`kpop-match-recorded-map-daily-${date}`]);

    rerender({ roundDate: date, isComplete: true, isWin: false, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 1, won: 1 });
  });

  it("counts a finished round restored from storage on the first load that finds it uncounted", () => {
    const props = { roundDate: date, isComplete: true, isWin: false, isReplay: false };
    renderRecord(props).unmount();
    expect(gameCounts("map")).toEqual({ played: 1, won: 0 });
    renderRecord(props);
    expect(gameCounts("map")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a restarted round completed again", () => {
    const { rerender } = renderRecord({ roundDate: date, isComplete: true, isWin: false, isReplay: false });
    rerender({ roundDate: date, isComplete: false, isWin: false, isReplay: false });
    rerender({ roundDate: date, isComplete: true, isWin: true, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a round already counted under the legacy per-round marker", () => {
    localStorage.setItem(`kpop-match-recorded-map-map-${date}`, "1");
    renderRecord({ roundDate: date, isComplete: true, isWin: true, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 0, won: 0 });
  });

  it("counts nothing for a replay", () => {
    renderRecord({ roundDate: date, isComplete: true, isWin: true, isReplay: true });
    expect(gameCounts("map")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });

  it("counts each round date on its own", () => {
    const { rerender } = renderRecord({ roundDate: date, isComplete: true, isWin: true, isReplay: false });
    rerender({ roundDate: "2026-11-15", isComplete: true, isWin: true, isReplay: false });
    expect(gameCounts("map")).toEqual({ played: 2, won: 2 });
    expect(matchMarkers()).toEqual([
      `kpop-match-recorded-map-daily-${date}`,
      "kpop-match-recorded-map-daily-2026-11-15",
    ]);
  });
});
