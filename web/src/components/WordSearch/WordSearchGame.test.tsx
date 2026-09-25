import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchGame } from "./WordSearchGame";
import { getMessages } from "../../i18n/catalog";

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;
const tPt = getMessages("pt-BR").wordSearch;

describe("WordSearchGame component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders theme title, counter, timer, grid, and word list", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByText("Integrantes do grupo Super Junior-T")).toBeInTheDocument();
    expect(screen.getByTestId("found-counter")).toHaveTextContent(`0 / ${puzzle.words.length}`);
    expect(screen.getByTestId("timer-display")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: tPt.gridLabel })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: tPt.wordsHeading })).toBeInTheDocument();
  });

  it("keeps the word list heading free of a second counter", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByRole("heading", { name: tPt.wordsHeading })).toHaveTextContent(/^Palavras$/);
  });

  it("shows only the letter count when every clue repeats the same text", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const item = document.querySelector(`[data-word-id="${target.id}"]`)!;
    expect(item).toHaveTextContent(tPt.lettersCount(target.word.length));
    expect(item).not.toHaveTextContent("Integrante do grupo");
  });

  it("shows each clue when the clues differ", () => {
    const words = puzzle.words.map((w, i) => ({
      ...w,
      clue: { "pt-BR": `Pista ${i}`, en: `Clue ${i}` },
    }));
    render(<WordSearchGame locale="pt-BR" puzzle={{ ...puzzle, words }} />);

    const first = document.querySelector(`[data-word-id="${words[0]!.id}"]`)!;
    expect(first).toHaveTextContent(`Pista 0 (${tPt.lettersCount(words[0]!.word.length)})`);
  });

  it("selects a word via pointer interactions and marks it found", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const startCell = screen.getByLabelText(new RegExp(`^Linha ${target.start_row + 1}, coluna ${target.start_col + 1},`));
    const endCell = screen.getByLabelText(new RegExp(`^Linha ${target.end_row + 1}, coluna ${target.end_col + 1},`));

    fireEvent.pointerDown(startCell);
    fireEvent.pointerEnter(endCell);
    fireEvent.pointerUp(endCell);

    expect(screen.getByTestId("found-counter")).toHaveTextContent(`1 / ${puzzle.words.length}`);
    const wordItem = document.querySelector(`[data-word-id="${target.id}"]`);
    expect(wordItem).toHaveClass("is-found");
  });

  it("toggles easy mode and hides/reveals word names", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    // In normal mode (default), names are hidden
    expect(screen.queryByText("Shindong")).not.toBeInTheDocument();

    const toggleBtn = screen.getByRole("button", { name: tPt.showWords });
    fireEvent.click(toggleBtn);

    // In easy mode, names are revealed
    expect(screen.getByText("Shindong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.hideWords })).toBeInTheDocument();

    // Toggle back to normal mode
    fireEvent.click(screen.getByRole("button", { name: tPt.hideWords }));
    expect(screen.queryByText("Shindong")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.showWords })).toBeInTheDocument();
  });

  it("selects a word via two clicks on the grid", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const startCell = screen.getByLabelText(new RegExp(`^Linha ${target.start_row + 1}, coluna ${target.start_col + 1},`));
    const endCell = screen.getByLabelText(new RegExp(`^Linha ${target.end_row + 1}, coluna ${target.end_col + 1},`));

    // First click: anchor
    fireEvent.pointerDown(startCell);
    fireEvent.pointerUp(startCell);

    // Second click: confirm
    fireEvent.pointerDown(endCell);
    fireEvent.pointerUp(endCell);

    expect(screen.getByTestId("found-counter")).toHaveTextContent(`1 / ${puzzle.words.length}`);
    const wordItem = document.querySelector(`[data-word-id="${target.id}"]`);
    expect(wordItem).toHaveClass("is-found");
    // Once found, the real name is visible even in normal mode with check icon
    expect(screen.getByText("Shindong")).toBeInTheDocument();
  });

  it("hides the sources button while a word is still hidden", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const target = puzzle.words[0]!;
    expect(
      screen.queryByRole("button", { name: new RegExp(`${tPt.viewEvidence}: ${target.canonical_name}`) }),
    ).not.toBeInTheDocument();
  });

  it("opens and closes evidence modal", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    fireEvent.click(screen.getByRole("button", { name: tPt.showWords }));
    const target = puzzle.words[0]!;
    const triggerBtn = screen.getByRole("button", {
      name: new RegExp(`${tPt.viewEvidence}: ${target.canonical_name}`),
    });
    fireEvent.click(triggerBtn);

    expect(screen.getByRole("dialog", { name: new RegExp(tPt.evidenceModalTitle) })).toBeInTheDocument();
    expect(screen.getByText(target.id)).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: tPt.close });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("completes the puzzle and copies share summary", async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardSpy },
    });

    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    for (const w of puzzle.words) {
      const startCell = screen.getByLabelText(new RegExp(`^Linha ${w.start_row + 1}, coluna ${w.start_col + 1},`));
      const endCell = screen.getByLabelText(new RegExp(`^Linha ${w.end_row + 1}, coluna ${w.end_col + 1},`));
      fireEvent.pointerDown(startCell);
      fireEvent.pointerUp(endCell);
    }

    expect(screen.getByRole("dialog", { name: tPt.congratulations })).toBeInTheDocument();
    const shareBtn = screen.getByRole("button", { name: tPt.shareResult });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(clipboardSpy).toHaveBeenCalled();
    });
  });

  it("asynchronously loads puzzle when omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => puzzle,
      })
    );

    render(<WordSearchGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    expect(screen.getByText(tPt.loading)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("found-counter")).toBeInTheDocument();
    });
  });

  it("shows error and retry button on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
    );

    render(<WordSearchGame locale="pt-BR" baseUrl="http://localhost:3000" />);

    await waitFor(() => {
      expect(screen.getByText(tPt.artifactMissing)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: tPt.retry })).toBeInTheDocument();
    });
  });
});
