import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/name-guess.daily.json";
import { getMessages } from "../../i18n/catalog";
import { loadPlayerStats, PLAYER_STATS_STORAGE_KEY } from "../../lib/player-stats";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { dayAfter, onDay, resetStaleDaily, serveDailyBoard } from "../../test/stale-daily";
import { NameGuessGame } from "./NameGuessGame";
import { nameGuessMatchId } from "./useNameGuessGame";

// Pins how a Name round reaches the player stats: the match id, the marker it
// leaves, which rounds count (ADR 030) and the guess count of a win.

const puzzle = validPuzzleJson as unknown as NameGuessPuzzle;
const t = getMessages("pt-BR").nameGuess;
const dailyMarker = `kpop-match-recorded-name-guess-daily-${puzzle.reference_date}`;
const WRONG = ["AESPA", "ALICE", "ALPHA", "APRIL", "BRAVE", "DREAM"];

function typeGuess(word: string) {
  for (const char of word) fireEvent.click(screen.getByRole("button", { name: char }));
  fireEvent.click(screen.getByRole("button", { name: t.enter }));
}

function guessDistribution() {
  return loadPlayerStats().games["name-guess"].guessDistribution;
}

/** Forgets the counted match and keeps the saved board, as before the match was counted. */
function forgetCount() {
  localStorage.removeItem(PLAYER_STATS_STORAGE_KEY);
  localStorage.removeItem(dailyMarker);
}

describe("Name match record", () => {
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
    expect(nameGuessMatchId(puzzle)).toBe(`name-guess-${puzzle.puzzle_id}`);
  });

  it("counts a win once, under the marker of the board's date, with its guess count", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    typeGuess(WRONG[0]!);
    expect(gameCounts("name-guess")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    typeGuess(WRONG[1]!);
    typeGuess("TWICE");
    expect(gameCounts("name-guess")).toEqual({ played: 1, won: 1 });
    expect(guessDistribution()).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0 });
    expect(loadPlayerStats().games["name-guess"].lastPlayedDate).toBe(puzzle.reference_date);
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts six wrong guesses as played without a win and no guess count", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    for (const guess of WRONG) typeGuess(guess);
    expect(gameCounts("name-guess")).toEqual({ played: 1, won: 0 });
    expect(guessDistribution()).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a give-up as played without a win", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    expect(gameCounts("name-guess")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted, with its guess count", () => {
    const first = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    typeGuess(WRONG[0]!);
    typeGuess("TWICE");
    first.unmount();
    forgetCount();

    const second = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    expect(gameCounts("name-guess")).toEqual({ played: 1, won: 1 });
    expect(guessDistribution()).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
    second.unmount();

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    expect(gameCounts("name-guess")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("does not count a restored game already counted under the legacy per-board marker", () => {
    const first = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    typeGuess("TWICE");
    first.unmount();
    forgetCount();
    localStorage.setItem(`kpop-match-recorded-name-guess-name-guess-${puzzle.puzzle_id}`, "1");

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    expect(screen.getByRole("heading", { name: t.wonTitle })).toBeInTheDocument();
    expect(gameCounts("name-guess")).toEqual({ played: 0, won: 0 });
  });

  it("counts nothing for a board the loader served after its day", async () => {
    onDay(dayAfter(puzzle.reference_date));
    serveDailyBoard(puzzle);
    render(<NameGuessGame locale="pt-BR" />);
    await screen.findByRole("button", { name: t.enter });
    typeGuess("TWICE");
    expect(screen.getByTestId("stale-daily-notice")).toBeInTheDocument();
    expect(gameCounts("name-guess")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });
});
