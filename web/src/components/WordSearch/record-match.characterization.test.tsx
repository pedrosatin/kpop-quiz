import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import { getMessages } from "../../i18n/catalog";
import { PLAYER_STATS_STORAGE_KEY } from "../../lib/player-stats";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { gameCounts, matchMarkers } from "../../test/match-records";
import { dayAfter, onDay, resetStaleDaily, serveDailyBoard } from "../../test/stale-daily";
import { WordSearchGame } from "./WordSearchGame";
import { wordSearchMatchId } from "./useWordSearchGame";

// Pins how a Word Search round reaches the player stats: the match id, the
// marker it leaves and which rounds count (ADR 030).

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;
const tPt = getMessages("pt-BR").wordSearch;
const saveKey = `kpop-word-search-${puzzle.puzzle_id}`;
const dailyMarker = `kpop-match-recorded-word-search-daily-${puzzle.reference_date}`;

function cell(row: number, col: number): HTMLElement {
  return screen.getByLabelText(new RegExp(`^Linha ${row + 1}, coluna ${col + 1},`));
}

function select(word: WordSearchWord): void {
  fireEvent.pointerDown(cell(word.start_row, word.start_col));
  fireEvent.pointerUp(cell(word.end_row, word.end_col));
}

function storeFinished(foundWordIds: string[]): void {
  localStorage.setItem(saveKey, JSON.stringify({ foundWordIds, elapsedSeconds: 60, status: "completed", easyMode: false }));
}

describe("Word Search match record", () => {
  beforeEach(() => { localStorage.clear(); });

  afterEach(() => {
    cleanup();
    resetStaleDaily();
    vi.restoreAllMocks();
  });

  it("names the match after the puzzle id", () => {
    expect(wordSearchMatchId(puzzle)).toBe(`word-search-${puzzle.puzzle_id}`);
  });

  it("counts every word found as a win once, under the marker of the board's date", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const [last, ...rest] = [...puzzle.words].reverse();
    for (const word of rest) select(word);
    expect(gameCounts("word-search")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);

    select(last!);
    expect(gameCounts("word-search")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a give-up with words left as played without a win", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    select(puzzle.words[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desistir" }));
    expect(gameCounts("word-search")).toEqual({ played: 1, won: 0 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a finished game restored from storage on the first load that finds it uncounted", () => {
    storeFinished(puzzle.words.map((word) => word.id));
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />).unmount();
    expect(gameCounts("word-search")).toEqual({ played: 1, won: 1 });

    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    expect(screen.getByRole("heading", { level: 2, name: tPt.congratulations })).toBeInTheDocument();
    expect(gameCounts("word-search")).toEqual({ played: 1, won: 1 });
    expect(matchMarkers()).toEqual([dailyMarker]);
  });

  it("counts a restored give-up as played without a win", () => {
    storeFinished([puzzle.words[0]!.id]);
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    expect(gameCounts("word-search")).toEqual({ played: 1, won: 0 });
  });

  it("does not count a restored game already counted under the legacy per-board marker", () => {
    storeFinished(puzzle.words.map((word) => word.id));
    localStorage.setItem(`kpop-match-recorded-word-search-word-search-${puzzle.puzzle_id}`, "1");
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    expect(gameCounts("word-search")).toEqual({ played: 0, won: 0 });
    // DailyNext may write dailySetLines for the day share; match counts stay zero.
    const raw = localStorage.getItem(PLAYER_STATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        overall: { played: number; won: number };
        games: { "word-search": { played: number; won: number } };
      };
      expect(parsed.overall).toMatchObject({ played: 0, won: 0 });
      expect(parsed.games["word-search"]).toMatchObject({ played: 0, won: 0 });
    }
  });

  it("counts nothing for a board the loader served after its day", async () => {
    onDay(dayAfter(puzzle.reference_date));
    serveDailyBoard(puzzle);
    render(<WordSearchGame locale="pt-BR" />);
    await screen.findByTestId("found-counter");
    for (const word of puzzle.words) select(word);
    expect(screen.getByTestId("stale-daily-notice")).toBeInTheDocument();
    expect(gameCounts("word-search")).toEqual({ played: 0, won: 0 });
    expect(matchMarkers()).toEqual([]);
  });
});
