import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import { WordSearchGame } from "./WordSearchGame";
import { wordSources } from "./WordSearchResult";
import { getMessages } from "../../i18n/catalog";
import { generateWordSearchShareSummary } from "./utils";
import { loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;
const pt = getMessages("pt-BR");
const tPt = pt.wordSearch;

function cell(row: number, col: number): HTMLElement {
  return screen.getByLabelText(new RegExp(`^Linha ${row + 1}, coluna ${col + 1},`));
}

// Drags from the first letter of a word to the last one.
function select(word: WordSearchWord): void {
  fireEvent.pointerDown(cell(word.start_row, word.start_col));
  fireEvent.pointerUp(cell(word.end_row, word.end_col));
}

function findAll(): void {
  for (const w of puzzle.words) select(w);
}

function liveRegion(container: Element): HTMLElement {
  return container.querySelector<HTMLElement>(".game-actions .game-actions-message[role='status'][aria-live='polite']")!;
}

function storeFinished(): void {
  localStorage.setItem(
    `kpop-word-search-${puzzle.puzzle_id}`,
    JSON.stringify({
      foundWordIds: puzzle.words.map((w) => w.id),
      elapsedSeconds: 125,
      status: "completed",
      easyMode: false,
    }),
  );
}

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
    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(0, puzzle.words.length));
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

    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
    const wordItem = document.querySelector(`[data-word-id="${target.id}"]`);
    expect(wordItem).toHaveClass("is-found");
  });

  it("finds a word dragged by touch, where the browser sends every event to the first cell", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    const startCell = screen.getByLabelText(new RegExp(`^Linha ${target.start_row + 1}, coluna ${target.start_col + 1},`));
    const endCell = screen.getByLabelText(new RegExp(`^Linha ${target.end_row + 1}, coluna ${target.end_col + 1},`));
    const grid = screen.getByRole("grid");

    // Touch input captures the pointer on the element it started on, so the
    // move and up events keep targeting the first cell. Only the coordinates
    // say where the finger is.
    const underFinger = vi.fn<(x: number, y: number) => Element | null>(() => startCell);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: underFinger });

    try {
      fireEvent.pointerDown(startCell, { clientX: 1, clientY: 1, buttons: 1 });
      underFinger.mockReturnValue(endCell.querySelector(".cell-letter") ?? endCell);
      fireEvent.pointerMove(grid, { clientX: 99, clientY: 99, buttons: 1 });
      fireEvent.pointerUp(startCell, { clientX: 99, clientY: 99 });
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }

    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
    expect(document.querySelector(`[data-word-id="${target.id}"]`)).toHaveClass("is-found");
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

    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
    const wordItem = document.querySelector(`[data-word-id="${target.id}"]`);
    expect(wordItem).toHaveClass("is-found");
    // Once found, the real name is visible even in normal mode with check icon
    expect(screen.getByText("Shindong")).toBeInTheDocument();
  });

  it("offers no sources while the puzzle is in progress, since they name the words", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    select(puzzle.words[0]!);

    expect(screen.queryByRole("button", { name: pt.showSource })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("marks found words in text and color class, not color alone", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    select(target);

    const item = document.querySelector(`[data-word-id="${target.id}"]`)!;
    expect(item).toHaveClass("is-found");
    expect(item.className).toMatch(/color-\d/);
    expect(item).toHaveTextContent(`Shindong, ${tPt.foundState}`);
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

describe("WordSearch action bar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("mounts the live region in the bar with the instructions, and keeps the progress out of it", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const bar = container.querySelector(".game-actions")!;
    const region = liveRegion(container);

    expect(region).toHaveTextContent(tPt.selectionHint);
    expect(bar.lastElementChild).toBe(bar.querySelector(".word-search-progress"));
    expect(within(bar as HTMLElement).getByTestId("found-counter")).toHaveTextContent(tPt.progress(0, puzzle.words.length));
    expect(region).not.toContainElement(screen.getByTestId("found-counter"));
    expect(region.querySelector("button")).toBeNull();
    // The bar is the last part of the card, after the grid and the words.
    expect(bar.parentElement!.lastElementChild).toBe(bar);
    expect(bar.compareDocumentPosition(screen.getByRole("grid")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("shows the selection in the bar while it grows", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;

    fireEvent.pointerDown(cell(target.start_row, target.start_col));
    fireEvent.pointerUp(cell(target.start_row, target.start_col));
    expect(liveRegion(container)).toHaveTextContent(tPt.anchorHint("S"));

    fireEvent.pointerEnter(cell(target.end_row, target.end_col));
    expect(liveRegion(container)).toHaveTextContent("SHINDONG");
    expect(liveRegion(container)).toHaveTextContent(tPt.lettersCount(8));
  });

  it("says which word was found in the bar, next to the grid highlight", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const grid = screen.getByRole("grid");
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    select(target);

    const region = liveRegion(container);
    expect(region).toHaveTextContent(tPt.foundFeedback("Shindong"));
    expect(region).toHaveTextContent(tPt.progressAnnouncement(1, puzzle.words.length));
    expect(container.querySelector(".game-actions")).toHaveClass("is-correct");
    expect(cell(target.start_row, target.start_col)).toHaveAttribute("data-found", "true");
    // The grid is the same node: the verdict lives in the bar, not above it.
    expect(screen.getByRole("grid")).toBe(grid);

    // The next selection replaces the verdict.
    fireEvent.pointerDown(cell(0, 0));
    expect(region).not.toHaveTextContent(tPt.foundFeedback("Shindong"));
    expect(container.querySelector(".game-actions")).not.toHaveClass("is-correct");
  });

  it("announces a word found with the keyboard", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const target = puzzle.words.find((w) => w.start_row === w.end_row) ?? puzzle.words[0]!;
    const grid = screen.getByRole("grid");
    const move = (from: number, to: number, less: string, more: string) => {
      for (let i = from; i < to; i++) fireEvent.keyDown(grid, { key: more });
      for (let i = from; i > to; i--) fireEvent.keyDown(grid, { key: less });
    };

    move(0, target.start_row, "ArrowUp", "ArrowDown");
    move(0, target.start_col, "ArrowLeft", "ArrowRight");
    fireEvent.keyDown(grid, { key: "Enter" });
    move(target.start_row, target.end_row, "ArrowUp", "ArrowDown");
    move(target.start_col, target.end_col, "ArrowLeft", "ArrowRight");
    fireEvent.keyDown(grid, { key: "Enter" });

    const name = target.labels["pt-BR"] || target.canonical_name;
    expect(liveRegion(container)).toHaveTextContent(tPt.foundFeedback(name));
  });

  it("says when a selection is not one of the names, in text and color", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.pointerDown(cell(0, 0));
    fireEvent.pointerUp(cell(0, 2));

    const letters = puzzle.grid[0]!.slice(0, 3).join("");
    expect(liveRegion(container)).toHaveTextContent(tPt.missFeedback(letters));
    expect(container.querySelector(".game-actions")).toHaveClass("is-incorrect");
  });

  it("says when a word was already found", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const target = puzzle.words.find((w) => w.word === "SHINDONG")!;
    select(target);
    select(target);

    expect(liveRegion(container)).toHaveTextContent(tPt.repeatFeedback("Shindong"));
    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
  });
});

describe("WordSearch end of puzzle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("puts the result in the bar and focuses its title when the puzzle ends in this visit", () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    findAll();

    const bar = container.querySelector(".game-actions") as HTMLElement;
    const title = within(bar).getByRole("heading", { level: 2, name: tPt.congratulations });
    expect(document.activeElement).toBe(title);
    expect(bar).toHaveClass("is-correct");
    expect(within(bar).getByRole("button", { name: pt.share })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: pt.showSource })).toBeInTheDocument();
    expect(bar.querySelector(".word-search-progress")).toBeNull();
    expect(screen.queryByRole("button", { name: tPt.showWords })).not.toBeInTheDocument();
    // No dialog: the result is part of the page.
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("restores a finished puzzle without moving focus", () => {
    storeFinished();
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByRole("heading", { level: 2, name: tPt.congratulations })).toBeInTheDocument();
    expect(screen.getByText(tPt.resultSummary(puzzle.words.length, "02:05"))).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("restores a puzzle in progress without moving focus", () => {
    localStorage.setItem(
      `kpop-word-search-${puzzle.puzzle_id}`,
      JSON.stringify({ foundWordIds: [puzzle.words[0]!.id], elapsedSeconds: 10, status: "in_progress", easyMode: false }),
    );
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
    expect(document.activeElement).toBe(document.body);
  });

  it("does not count a restored puzzle whose finish was already recorded", () => {
    markGameMatchRecorded("word-search", `word-search-${puzzle.puzzle_id}`);
    storeFinished();
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByRole("heading", { level: 2, name: tPt.congratulations })).toBeInTheDocument();
    expect(loadPlayerStats().games["word-search"]?.played ?? 0).toBe(0);
  });

  it("counts a puzzle finished in this visit once", () => {
    const { unmount } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    findAll();
    expect(loadPlayerStats().games["word-search"]?.played).toBe(1);

    unmount();
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    expect(loadPlayerStats().games["word-search"]?.played).toBe(1);
  });

  it("shows every word's Wikidata item and cited revision behind Ver fonte", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    findAll();
    const toggle = screen.getByRole("button", { name: pt.showSource });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(pt.hideSource);
    expect(panel).toBeVisible();
    for (const word of puzzle.words) {
      expect(within(panel).getByRole("heading", { level: 3, name: word.labels["pt-BR"] })).toBeInTheDocument();
      const hrefs = within(panel).getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(hrefs).toContain(`https://www.wikidata.org/wiki/${word.id}`);
      for (const evidence of word.evidence) expect(hrefs).toContain(evidence.source_url);
    }

    fireEvent.click(toggle);
    expect(panel).not.toBeVisible();
  });

  it("shows each word's clue and every location in the source behind Ver fonte", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    findAll();
    fireEvent.click(screen.getByRole("button", { name: pt.showSource }));
    const panel = document.querySelector<HTMLElement>(".word-search-source")!;

    for (const word of puzzle.words) {
      const title = within(panel).getByRole("heading", { level: 3, name: word.labels["pt-BR"] });
      const block = title.closest<HTMLElement>(".word-search-source-word")!;
      expect(block.querySelector(".word-search-source-clue")).toHaveTextContent(
        `${tPt.evidenceClue} ${word.clue!["pt-BR"]}`,
      );
      // The clue comes before the source lines.
      const clue = block.querySelector(".word-search-source-clue")!;
      expect(clue.compareDocumentPosition(block.querySelector("ul")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const evidence of word.evidence) {
        expect(block).toHaveTextContent(`${tPt.evidenceLocator} ${evidence.locator}`);
      }
    }
  });

  it("labels the clue and the location in English", () => {
    render(<WordSearchGame locale="en" puzzle={puzzle} />);
    const en = getMessages("en");
    for (const w of puzzle.words) {
      fireEvent.pointerDown(screen.getByLabelText(new RegExp(`^Row ${w.start_row + 1}, column ${w.start_col + 1},`)));
      fireEvent.pointerUp(screen.getByLabelText(new RegExp(`^Row ${w.end_row + 1}, column ${w.end_col + 1},`)));
    }
    fireEvent.click(screen.getByRole("button", { name: en.showSource }));
    const panel = document.querySelector<HTMLElement>(".word-search-source")!;
    const word = puzzle.words[0]!;
    expect(panel).toHaveTextContent(`Clue: ${word.clue!.en}`);
    expect(panel).toHaveTextContent(`Location in source: ${word.evidence[0]!.locator}`);
  });

  it("describes the result title with the summary", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    findAll();
    const title = screen.getByRole("heading", { level: 2, name: tPt.congratulations });
    const summary = document.getElementById(title.getAttribute("aria-describedby")!)!;
    expect(summary).toHaveClass("word-search-result-summary");
    expect(title).toHaveAccessibleDescription(summary.textContent!);
  });
});

describe("wordSources", () => {
  const base = puzzle.words[0]!.evidence[0]!;
  const withEvidence = (evidence: WordSearchWord["evidence"]): WordSearchPuzzle => ({
    ...puzzle,
    words: [{ ...puzzle.words[0]!, evidence }],
  });

  it("keeps one line per revision and location, dropping exact repeats", () => {
    const other = { ...base, locator: `${base.locator}-other`, fact_base_id: "other" };
    const lines = wordSources(withEvidence([base, { ...base, fact_base_id: "copy" }, other]), puzzle.words[0]!.id);
    expect(lines.map((line) => line.locator)).toEqual([base.locator, other.locator]);
    expect(lines.every((line) => line.revision === base.revision_id && line.url === base.source_url)).toBe(true);
    expect(lines[0]!.project).toBe("Wikipedia");
  });

  it("names Wikidata revisions as Wikidata", () => {
    const wikidata = {
      ...base,
      source_url: "https://www.wikidata.org/w/index.php?title=Q1&oldid=5",
      revision_id: 5,
      locator: "wikidata:Q1:P527",
    };
    const [line] = wordSources(withEvidence([wikidata]), puzzle.words[0]!.id);
    expect(line).toMatchObject({ project: "Wikidata", revision: 5, locator: "wikidata:Q1:P527" });
  });
});

describe("WordSearch share", () => {
  const original = {
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  };

  function setNavigator(key: "share" | "clipboard", value: unknown) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }

  async function finishAndShare() {
    storeFinished();
    const view = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: pt.share }));
    });
    return view;
  }

  const shareText = () => generateWordSearchShareSummary(puzzle, puzzle.words.length, puzzle.words.length, 125);

  beforeEach(() => {
    localStorage.clear();
    setNavigator("share", undefined);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    for (const key of ["share", "clipboard"] as const) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
  });

  it("copies the result and announces it again on a second copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const { container } = await finishAndShare();

    expect(writeText).toHaveBeenCalledWith(shareText());
    const region = liveRegion(container);
    expect(region).toHaveTextContent(pt.copiedToClipboard);
    expect(screen.getByRole("button", { name: pt.copiedToClipboard })).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();

    const first = region.querySelector("p");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: pt.copiedToClipboard }));
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    const second = region.querySelector("p");
    expect(second).toHaveTextContent(pt.copiedToClipboard);
    expect(second).not.toBe(first);
  });

  it("uses the share sheet first and does not copy", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    setNavigator("clipboard", { writeText });
    await finishAndShare();

    expect(share).toHaveBeenCalledWith({ text: shareText() });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a closed share sheet as no error", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    setNavigator("clipboard", { writeText });
    const { container } = await finishAndShare();

    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(liveRegion(container)).toBeEmptyDOMElement();
  });

  it("falls back to the clipboard when the share sheet fails", async () => {
    setNavigator("share", vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const { container } = await finishAndShare();

    expect(writeText).toHaveBeenCalledWith(shareText());
    expect(liveRegion(container)).toHaveTextContent(pt.copiedToClipboard);
  });

  it("shows the text to copy by hand and says so when the clipboard refuses", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const { container } = await finishAndShare();

    expect(liveRegion(container)).toHaveTextContent(pt.shareFailed);
    const field = screen.getByRole("textbox", { name: pt.shareTextLabel });
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toBe(shareText());
    expect(field).toHaveAccessibleDescription(pt.shareFailed);
  });

  it("shows the text to copy by hand when there is no clipboard", async () => {
    setNavigator("clipboard", undefined);
    const { container } = await finishAndShare();

    expect(liveRegion(container)).toHaveTextContent(pt.shareFailed);
    expect(screen.getByRole("textbox", { name: pt.shareTextLabel })).toBeInTheDocument();
  });

  it("stops the Copied timer when the result goes away", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setNavigator("clipboard", { writeText: vi.fn().mockResolvedValue(undefined) });
      const { unmount } = await finishAndShare();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WordSearch chip row", () => {
  const props = ["scrollWidth", "clientWidth"] as const;
  const saved = props.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));

  afterEach(() => {
    props.forEach((key, i) => {
      if (saved[i]) Object.defineProperty(HTMLElement.prototype, key, saved[i]!);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    });
    localStorage.clear();
  });

  function list(): HTMLElement {
    return document.querySelector<HTMLElement>(".word-search-words")!;
  }

  it("stays out of the tab order when every chip fits", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    expect(list()).not.toHaveAttribute("tabindex");
    expect(list()).not.toHaveClass("has-more-end");
  });

  it("takes focus and marks the hidden ends when the chips scroll", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 500 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 200 });
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    expect(list()).toHaveAttribute("tabindex", "0");
    expect(list()).toHaveAccessibleName(tPt.wordsHeading);
    expect(list()).toHaveClass("has-more-end");
    expect(list()).not.toHaveClass("has-more-start");

    list().scrollLeft = 300;
    fireEvent.scroll(list());
    expect(list()).toHaveClass("has-more-start");
    expect(list()).not.toHaveClass("has-more-end");
  });
});
