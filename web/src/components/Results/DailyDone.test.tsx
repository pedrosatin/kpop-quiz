import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crosswordJson from "../../../public/data/crossword-pilot.json";
import type { CrosswordPuzzle } from "../../data/crossword";
import { getMessages } from "../../i18n/catalog";
import { loadPlayerStats, recordMatchOnce, type GameId } from "../../lib/player-stats";
import type { NameGuessPuzzle, TimelinePuzzle } from "../../lib/quiz-types";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import gridJson from "../../tests/fixtures/grid.daily.json";
import nameGuessJson from "../../tests/fixtures/name-guess.daily.json";
import timelineJson from "../../tests/fixtures/timeline.daily.json";
import wordSearchJson from "../../tests/fixtures/word-search.daily.json";
import { CrosswordGameContent } from "../Crossword/CrosswordGameContent";
import { IntersectionGrid } from "../Grid/IntersectionGrid";
import { NameGuessGame } from "../NameGuess/NameGuessGame";
import { TimelineGame } from "../Timeline/TimelineGame";
import { WordSearchGame } from "../WordSearch/WordSearchGame";
import { DailyDone } from "./DailyDone";

const pt = getMessages("pt-BR");
const en = getMessages("en");

/**
 * Each case opens the fixture board with the date's match already counted
 * under another board of the same date, which is what a player who finished
 * the day sees after a republication (ADR 030).
 */
const cases: { game: GameId; date: string; open: () => void }[] = [
  {
    game: "name-guess",
    date: (nameGuessJson as unknown as NameGuessPuzzle).reference_date,
    open: () => render(<NameGuessGame locale="pt-BR" puzzle={nameGuessJson as unknown as NameGuessPuzzle} />),
  },
  {
    game: "word-search",
    date: (wordSearchJson as unknown as WordSearchPuzzle).reference_date,
    open: () => render(<WordSearchGame locale="pt-BR" puzzle={wordSearchJson as unknown as WordSearchPuzzle} />),
  },
  {
    game: "timeline",
    date: (timelineJson as unknown as TimelinePuzzle).reference_date!,
    open: () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(timelineJson))));
      render(<TimelineGame locale="pt-BR" />);
    },
  },
  {
    game: "grid",
    date: gridJson.reference_date,
    open: () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => url.includes("grid-publication.") ? new Response(null, { status: 404 }) : new Response(JSON.stringify(gridJson))),
      );
      render(<IntersectionGrid locale="pt-BR" messages={pt} />);
    },
  },
  {
    game: "crossword",
    date: crosswordJson.reference_date,
    open: () => render(<CrosswordGameContent puzzle={crosswordJson as unknown as CrosswordPuzzle} locale="pt-BR" messages={pt} />),
  },
];

describe("DailyDone after a republished board", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(cases)("$game shows the day as done and counts nothing", async ({ game, date, open }) => {
    recordMatchOnce(game, `${game}-earlier-board`, true, date);
    const before = loadPlayerStats();

    open();
    await waitFor(() => expect(screen.getByTestId("daily-done")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 2, name: pt.dailyDoneTitle })).toBeInTheDocument();
    expect(screen.getByText(pt.dailyDoneBody)).toBeInTheDocument();
    expect(screen.queryByTestId("game-board")).toBeNull();
    expect(loadPlayerStats()).toEqual(before);
  });

  it("ignores the physical keyboard of the Guess game while the day shows as done", async () => {
    const puzzle = nameGuessJson as unknown as NameGuessPuzzle;
    recordMatchOnce("name-guess", "name-guess-earlier-board", true, puzzle.reference_date);
    const before = loadPlayerStats();
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    await waitFor(() => expect(screen.getByTestId("daily-done")).toBeInTheDocument());

    // The answer typed on the keyboard would end the hidden game.
    for (const letter of puzzle.target.normalized_name) fireEvent.keyDown(window, { key: letter });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("daily-done")).toBeInTheDocument();
    expect(screen.queryByTestId("game-result")).toBeNull();
    expect(loadPlayerStats()).toEqual(before);
  });

  it("shows the English copy on the English pages", () => {
    render(<DailyDone game="timeline" locale="en" />);
    expect(screen.getByRole("heading", { level: 2, name: en.dailyDoneTitle })).toBeInTheDocument();
    expect(screen.getByText(en.dailyDoneBody)).toBeInTheDocument();
  });
});
