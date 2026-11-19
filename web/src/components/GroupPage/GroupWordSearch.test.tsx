import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import groupPuzzleJson from "../../../public/data/group-pages/stray-kids/word-search.json";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { getMessages } from "../../i18n/catalog";
import { isDailyMatchRecorded, loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";
import { generateWordSearchShareSummary } from "../WordSearch/utils";
import { WordSearchGame } from "../WordSearch/WordSearchGame";

const puzzle = groupPuzzleJson as unknown as WordSearchPuzzle;
const pt = getMessages("pt-BR");

function cell(row: number, col: number): HTMLElement {
  return screen.getByLabelText(new RegExp(`^Linha ${row + 1}, coluna ${col + 1},`));
}

function select(word: WordSearchWord): void {
  fireEvent.pointerDown(cell(word.start_row, word.start_col));
  fireEvent.pointerUp(cell(word.end_row, word.end_col));
}

function findAll(): void {
  for (const word of puzzle.words) select(word);
}

describe("group word search free play", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not count as the daily challenge or show DailyDone for that date", async () => {
    markGameMatchRecorded("word-search", `daily-${puzzle.reference_date}`);

    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} daily={false} />);

    expect(screen.getByTestId("game-board")).toBeInTheDocument();
    expect(screen.queryByTestId("daily-done")).toBeNull();

    findAll();
    await screen.findByTestId("game-result");

    expect(isDailyMatchRecorded("word-search", puzzle.reference_date)).toBe(true);
    expect(loadPlayerStats().games["word-search"]?.played ?? 0).toBe(0);
    expect(screen.queryByTestId("daily-next")).toBeNull();

    const share = generateWordSearchShareSummary(
      puzzle,
      puzzle.words.length,
      puzzle.words.length,
      10,
      "pt-BR",
      { daily: false },
    );
    expect(share).not.toMatch(/K-pop Quiz #\d+/);
    expect(share).toContain(pt.gameWordSearch);
  });

  it("still counts the same puzzle as daily when daily stays true", async () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} daily={true} />);
    findAll();
    await waitFor(() => {
      expect(loadPlayerStats().games["word-search"]?.played).toBe(1);
    });
    expect(isDailyMatchRecorded("word-search", puzzle.reference_date)).toBe(true);
  });
});
