import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import publishedJson from "../../../public/data/crossword-pilot.json";
import { validateCrosswordDaily, type CrosswordPuzzle } from "../../data/crossword";
import { dailyReferenceDate, noteDailyBoard } from "../../data/daily-artifact";
import { loadPlayerStats } from "../../lib/player-stats";
import { buildCrosswordDaily } from "../../test/crossword-daily-fixture";
import { dayAfter } from "../../test/stale-daily";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { storeCrosswordSave } from "./crossword-save";
import { crosswordMatchId, useCrosswordGame } from "./useCrosswordGame";

// Pins how a crossword round reaches the player stats: the match id, the
// marker it leaves and which rounds count (ADR 030).

const today = dailyReferenceDate();
const validated = await validateCrosswordDaily(await buildCrosswordDaily(publishedJson as unknown as CrosswordPuzzle, today));
if (validated.status !== "ready") throw new Error("fixture must be ready");
const puzzle = validated.puzzle;
const answers = Object.fromEntries(puzzle.cells.map((cell) => [`${cell.row}:${cell.col}`, cell.answer]));
const dailyMarker = `kpop-match-recorded-crossword-daily-${puzzle.reference_date}`;

function renderGame(board: CrosswordPuzzle = puzzle) {
  return renderHook(() => useCrosswordGame(board, "pt-BR"));
}

function win(game: ReturnType<typeof renderGame>) {
  act(() => game.result.current.setLetters(answers));
  act(() => { game.result.current.check(); });
}

describe("crossword match record", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("names the match after the board's checksum", () => {
    expect(crosswordMatchId(puzzle)).toBe(`crossword-${puzzle.dataset_version}`);
  });

  it("counts a win once, under the marker of the board's date", () => {
    const game = renderGame();
    act(() => game.result.current.setLetters({ [Object.keys(answers)[0]!]: "Z" }));
    act(() => { game.result.current.check(); });
    expect(gameCounts("crossword")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    win(game);
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 1 });
    expect(loadPlayerStats().games.crossword.lastPlayedDate).toBe(puzzle.reference_date);
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a reveal as played without a win", () => {
    const game = renderGame();
    act(() => game.result.current.reveal());
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a finished round restored from storage on the first load that finds it uncounted", () => {
    storeCrosswordSave(puzzle, { values: answers, status: "won", checks: 1 });
    renderGame().unmount();
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 1 });

    renderGame();
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("does not count a restarted board finished again", () => {
    const game = renderGame();
    act(() => game.result.current.reveal());
    act(() => game.result.current.restart());
    win(game);
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("does not count a round already counted under the legacy per-board marker", () => {
    localStorage.setItem(`kpop-match-recorded-crossword-crossword-${puzzle.dataset_version}`, "1");
    win(renderGame());
    expect(gameCounts("crossword")).toEqual({ played: 0, won: 0 });
  });

  it("does not count another board once the date's match is counted", () => {
    localStorage.setItem(dailyMarker, "1");
    win(renderGame());
    expect(gameCounts("crossword")).toEqual({ played: 0, won: 0 });
  });

  // The crossword loader never serves an earlier day's board, so the record
  // does not check for one.
  it("counts a board noted as served after its day under that day", () => {
    const stale = noteDailyBoard(puzzle, puzzle.reference_date, dayAfter(puzzle.reference_date));
    win(renderGame(stale));
    expect(gameCounts("crossword")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });
});
