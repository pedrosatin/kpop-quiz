import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import publishedJson from "../../../public/data/crossword-pilot.json";
import { entryCellKeys, type CrosswordPuzzle } from "../../data/crossword";
import { getMessages } from "../../i18n/catalog";
import * as analytics from "../../lib/game-analytics";
import { loadPlayerStats } from "../../lib/player-stats";
import { RESULT_GUARD_MS } from "../Results/use-result-action-guard";
import { CrosswordGame } from "./CrosswordGame";
import { generateCrosswordShareText } from "./CrosswordResult";
import { crosswordStorageKey } from "./crossword-save";

// The committed board is the fixed match and carries a valid checksum, so it
// doubles as the fixture of these tests.
const puzzle = publishedJson as unknown as CrosswordPuzzle;
const pt = getMessages("pt-BR");
const en = getMessages("en");
const STORAGE_KEY = crosswordStorageKey(puzzle);

let clock = 1000;

function serve(payload: unknown = puzzle) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload)))));
}

async function renderGame(locale: "pt-BR" | "en" = "pt-BR") {
  render(<CrosswordGame locale={locale} />);
  await screen.findByTestId("game-board");
}

function cellInput(row: number, col: number): HTMLInputElement {
  return screen.getByRole("textbox", { name: new RegExp(`^(Linha|Row) ${row + 1}, (coluna|column) ${col + 1}\\.`) }) as HTMLInputElement;
}

function typeEntry(index: number, text?: string) {
  const entry = puzzle.entries[index]!;
  const direction = entry.direction === "across" ? `(${pt.crosswordAcross}|${en.crosswordAcross})` : `(${pt.crosswordDown}|${en.crosswordDown})`;
  const label = `${entry.number} ${direction}:`;
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
  const first = cellInput(entry.row, entry.col);
  fireEvent.input(first, { target: { value: text ?? entry.answer } });
}

function solveAll() {
  puzzle.entries.forEach((_, i) => typeEntry(i));
}

async function pressAfterGuard(name: string) {
  clock += RESULT_GUARD_MS + 1;
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => {});
}

describe("CrosswordGame", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders one input per square, the clues and the action bar", async () => {
    serve();
    await renderGame();
    expect(screen.getAllByRole("textbox")).toHaveLength(puzzle.cells.length);
    expect(screen.getAllByRole("button", { name: /^\d (Horizontal|Vertical):/ })).toHaveLength(puzzle.entries.length);
    expect(screen.getByRole("status")).toHaveTextContent(pt.crosswordHint);
    expect(document.querySelector(".game-actions")).not.toBeNull();
  });

  it("types a word across its squares and normalizes accents and case", async () => {
    serve();
    await renderGame();
    typeEntry(2, "sístar");
    const entry = puzzle.entries[2]!;
    entryCellKeys(entry).forEach((key, i) => {
      const [r, c] = key.split(":").map(Number) as [number, number];
      expect(cellInput(r, c).value).toBe(entry.answer[i]);
    });
  });

  it("keeps the round open on a wrong check and announces it", async () => {
    serve();
    await renderGame();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordCheck }));
    expect(screen.getByRole("status")).toHaveTextContent(pt.crosswordWrong);
    expect(document.querySelector(".game-actions.is-incorrect")).not.toBeNull();
    expect(screen.queryByTestId("game-result")).toBeNull();
    expect(loadPlayerStats().games.crossword.played).toBe(0);
  });

  it("solves the board, records one win and focuses the result title", async () => {
    serve();
    await renderGame();
    solveAll();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordCheck }));
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 2, name: pt.crosswordResultWon })).toBe(document.activeElement);
    expect(screen.getByText(pt.crosswordSummaryWon(1))).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox", { hidden: false }).every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    const stats = loadPlayerStats().games.crossword;
    expect(stats.played).toBe(1);
    expect(stats.won).toBe(1);

    // A reload of the finished round restores it without counting it again.
    cleanup();
    await renderGame();
    expect(screen.getByRole("heading", { level: 2, name: pt.crosswordResultWon })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(loadPlayerStats().games.crossword.played).toBe(1);
  });

  it("counts a reveal as played without a win and keeps the words that were right", async () => {
    serve();
    await renderGame();
    typeEntry(0);
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordReveal }));
    fireEvent.click(screen.getByRole("button", { name: pt.revealConfirmAction }));
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 2, name: pt.crosswordResultRevealed })).toBeInTheDocument();
    expect(screen.getByText(pt.crosswordSummaryRevealed(1, puzzle.entries.length))).toBeInTheDocument();
    for (const cell of puzzle.cells) expect(cellInput(cell.row, cell.col).value).toBe(cell.answer);
    const stats = loadPlayerStats().games.crossword;
    expect(stats.played).toBe(1);
    expect(stats.won).toBe(0);
  });

  it("asks for confirmation before revealing and keeps the board on cancel or Escape", async () => {
    serve();
    await renderGame();
    typeEntry(0);
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordReveal }));
    expect(screen.getByRole("dialog", { name: pt.revealConfirmTitle })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: pt.crosswordResultRevealed })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: pt.cancel }));
    expect(screen.queryByRole("dialog", { name: pt.revealConfirmTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: pt.crosswordReveal })).toBeInTheDocument();
    expect(cellInput(puzzle.entries[0]!.row, puzzle.entries[0]!.col).value).toBe(puzzle.entries[0]!.answer[0]);

    fireEvent.click(screen.getByRole("button", { name: pt.crosswordReveal }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: pt.revealConfirmTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: pt.crosswordReveal })).toBeInTheDocument();
  });

  it("shows English reveal confirmation copy on crossword", async () => {
    serve();
    await renderGame("en");
    fireEvent.click(screen.getByRole("button", { name: en.crosswordReveal }));
    expect(screen.getByRole("dialog", { name: en.revealConfirmTitle })).toBeInTheDocument();
    expect(screen.getByText(en.revealConfirmBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.crosswordReveal })).toBeInTheDocument();
  });

  it("resumes letters from localStorage under the board hash", async () => {
    serve();
    await renderGame();
    typeEntry(0);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.status).toBe("playing");
    expect(Object.values(saved.values).join("")).toBe(puzzle.entries[0]!.answer);
    cleanup();
    await renderGame();
    expect(cellInput(puzzle.entries[0]!.row, puzzle.entries[0]!.col).value).toBe(puzzle.entries[0]!.answer[0]);
  });

  it("drops an edited save and the saves of other boards", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ values: { "9:9": "A" }, status: "playing", checks: 0 }));
    localStorage.setItem(`kpop-crossword-${"0".repeat(64)}`, "{}");
    serve();
    await renderGame();
    expect(screen.getAllByRole("textbox").every((i) => (i as HTMLInputElement).value === "")).toBe(true);
    expect(localStorage.getItem(`kpop-crossword-${"0".repeat(64)}`)).toBeNull();
  });

  it("does not trust a saved win the letters do not solve", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ values: {}, status: "won", checks: 1 }));
    serve();
    await renderGame();
    expect(screen.queryByTestId("game-result")).toBeNull();
  });

  it("sends game_start once and game_complete on the finish of this visit, with consent", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    analytics.setGameAnalyticsConsent("G-TEST", true);
    serve();
    await renderGame("en");
    solveAll();
    fireEvent.click(screen.getByRole("button", { name: en.crosswordCheck }));
    await act(async () => {});
    expect(gtag.mock.calls.map((call) => call[1])).toEqual(["game_start", "game_complete"]);
    expect(gtag.mock.calls[0]![2]).toMatchObject({ game: "crossword", locale: "en" });

    // A restored finished round replays nothing.
    cleanup();
    await renderGame("en");
    expect(gtag).toHaveBeenCalledTimes(2);
    analytics.setGameAnalyticsConsent("", false);
  });

  it("shares a spoiler-free text without a date and falls back to a text field", async () => {
    serve();
    await renderGame();
    solveAll();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordCheck }));
    await act(async () => {});
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await pressAfterGuard(pt.share);
    const field = screen.getByRole("textbox", { name: pt.shareTextLabel }) as HTMLTextAreaElement;
    expect(field.value).toContain("Cruzadinha de K-pop");
    expect(field.value).toContain("utm_campaign=crossword");
    expect(field.value).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const entry of puzzle.entries) expect(field.value).not.toContain(entry.answer);
  });

  it("builds one square per word, green only for the words that were right", () => {
    const values: Record<string, string> = {};
    entryCellKeys(puzzle.entries[0]!).forEach((key, i) => (values[key] = puzzle.entries[0]!.answer[i]!));
    const text = generateCrosswordShareText(puzzle, values, "revealed", 0, en, "en");
    const squares = text.split("\n")[2]!;
    expect([...squares]).toEqual(["🟩", ...Array(puzzle.entries.length - 1).fill("⬜")]);
    expect(text).toContain(en.crosswordSummaryRevealed(1, puzzle.entries.length));
  });

  it("opens the cited sources from the result", async () => {
    serve();
    await renderGame();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordReveal }));
    fireEvent.click(screen.getByRole("button", { name: pt.revealConfirmAction }));
    await act(async () => {});
    const toggle = screen.getByRole("button", { name: pt.showSource });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: pt.hideSource })).toHaveAttribute("aria-expanded", "true");
    const sources = puzzle.entries.flatMap((e) => e.sources);
    expect(document.querySelectorAll('.crossword-source a[href*="oldid="]')).toHaveLength(sources.length);
  });

  it("restarts after the end without counting the board again", async () => {
    serve();
    await renderGame();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordReveal }));
    fireEvent.click(screen.getByRole("button", { name: pt.revealConfirmAction }));
    await act(async () => {});
    await pressAfterGuard(pt.restart);
    expect(screen.queryByTestId("game-result")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    solveAll();
    fireEvent.click(screen.getByRole("button", { name: pt.crosswordCheck }));
    await act(async () => {});
    expect(loadPlayerStats().games.crossword.played).toBe(1);
  });

  it("offers a retry for a missing board and rejects a tampered one", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve(new Response("", { status: 404 }));
        if (calls === 2) return Promise.resolve(new Response(JSON.stringify({ ...puzzle, rows: 7 })));
        return Promise.resolve(new Response(JSON.stringify(puzzle)));
      }),
    );
    render(<CrosswordGame locale="pt-BR" />);
    expect(await screen.findByText(pt.crosswordArtifactMissing)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-retry"));
    expect(await screen.findByText(pt.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-retry"));
    expect(await screen.findByTestId("game-board")).toBeInTheDocument();
  });
});
