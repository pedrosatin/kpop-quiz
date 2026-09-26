import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridResults, RESULT_GUARD_MS, gridShareText } from "./GridResults";
import { cellSources, GridReview, readableLocator } from "./GridReview";
import { getMessages } from "../../i18n/catalog";
import type { IntersectionGrid } from "../../lib/quiz-types";
import validGridJson from "../../tests/fixtures/grid.daily.json";
import { cellKey, type GridCellState } from "./types";

const ptMessages = getMessages("pt-BR");
const validGrid = validGridJson as unknown as IntersectionGrid;

let clock = 0;

function sampleCellStates(solvedIndexes: [number, number][] = []): Record<string, GridCellState> {
  const states: Record<string, GridCellState> = {};
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      states[cellKey(r, c)] = { solved: false, failed: false };
    }
  }
  for (const [r, c] of solvedIndexes) {
    states[cellKey(r, c)] = {
      solved: true,
      failed: false,
      entityId: "Q21461452",
      entityName: "TWICE",
    };
  }
  return states;
}

function renderResults(overrides: Partial<Parameters<typeof GridResults>[0]> = {}) {
  const props = {
    grid: validGrid,
    cellStates: sampleCellStates([[0, 0]]),
    guessesUsed: 3,
    onRestart: vi.fn(),
    onCopied: vi.fn(),
    onShareFailed: vi.fn(),
    locale: "pt-BR" as const,
    messages: ptMessages,
    ...overrides,
  };
  render(<GridResults {...props} />);
  // Past the guard that protects the buttons from a double tap.
  clock += RESULT_GUARD_MS;
  return props;
}

describe("GridResults component", () => {
  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the title, described by the summary, without the intro kicker", () => {
    renderResults({ cellStates: sampleCellStates([[0, 0], [1, 1]]), guessesUsed: 5 });

    const title = screen.getByRole("heading", { name: "Fim da partida" });
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveAccessibleDescription("2 de 9 casas certas com 5 palpites");
    expect(screen.queryByText(ptMessages.gridEyebrow)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compartilhar resultado" })).toBeInTheDocument();
  });

  it("builds the share text with colored or high-contrast squares", () => {
    const states = sampleCellStates([[0, 0]]);
    expect(gridShareText(validGrid, states, 1, false, ptMessages)).toBe(
      "K-pop Grid 2026-09-17\n1/9 acertos (1 palpites)\n🟩🟥🟥\n🟥🟥🟥\n🟥🟥🟥",
    );
    expect(gridShareText(validGrid, states, 1, true, ptMessages)).toBe(
      "K-pop Grid 2026-09-17\n1/9 acertos (1 palpites)\n■□□\n□□□\n□□□",
    );
  });

  it("shares the high-contrast text once the box is checked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderResults();

    fireEvent.click(screen.getByRole("checkbox", { name: /alto contraste/i }));
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("■");
    expect(text).toContain("□");
    expect(text).not.toContain("🟩");
  });

  it("copies share text to clipboard when there is no share sheet and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const props = renderResults();

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));

    await waitFor(() => expect(props.onCopied).toHaveBeenCalledTimes(1));
    const copiedContent = writeText.mock.calls[0]![0] as string;
    expect(copiedContent).toContain("K-pop Grid 2026-09-17");
    expect(copiedContent).toContain("1/9 acertos (3 palpites)");
    expect(screen.getByRole("button", { name: "Resultado copiado." })).toBeInTheDocument();
  });

  it("invokes navigator.share when supported and stops there", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share: shareMock, clipboard: { writeText } });
    renderResults();

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(shareMock).toHaveBeenCalledWith({ text: expect.stringContaining("K-pop Grid 2026-09-17") });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not fall back when the player closes the share sheet", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } });
    const props = renderResults();

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).not.toHaveBeenCalled();
    expect(props.onShareFailed).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("copies when the share sheet fails, and shows the text to copy when the clipboard fails too", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("boom")), clipboard: { writeText } });
    const props = renderResults();

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar resultado" }));

    const field = await screen.findByRole("textbox", { name: ptMessages.shareTextLabel });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(props.onShareFailed).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toContain("K-pop Grid 2026-09-17");
    expect(field).toHaveAccessibleDescription(ptMessages.shareFailed);
  });

  it("keeps the answers and sources folded until asked", () => {
    renderResults();

    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");
    expect(screen.queryByText("Respostas e fontes")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Ocultar fonte");
    expect(panel).not.toHaveAttribute("hidden");
    expect(within(panel).getByText("Respostas e fontes")).toBeInTheDocument();
    expect(within(panel).getByText("Linha 1, coluna 1")).toBeInTheDocument();
    expect(within(panel).getAllByText("TWICE").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/Respostas aceitas:/)).toHaveLength(9);

    const evidenceLinks = within(panel).getAllByRole("link");
    expect(evidenceLinks).toHaveLength(9);
    for (const link of evidenceLinks) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAccessibleName("Abrir a revisão no Wikidata");
    }
    expect(within(panel).getAllByText(/Wikidata, revisão 1001\./).length).toBeGreaterThan(0);
    expect(panel.querySelector(".grid-source-locator")).toHaveTextContent("Local na fonte: declaração P264 e sua referência");
    expect(within(panel).getAllByTitle("claims/P264/Q21461452$1234/references/hash1").length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(panel).toHaveAttribute("hidden");
  });

  it("ignores Ver fonte right after the result appears and on a held Enter", () => {
    render(
      <GridResults
        grid={validGrid}
        cellStates={sampleCellStates()}
        guessesUsed={9}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    clock += RESULT_GUARD_MS - 1;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    toggle.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);

    clock += 1;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("puts the verdict of the last guess before the summary", () => {
    renderResults({ guessesUsed: 9, verdict: "Errada: SHINee." });

    const title = screen.getByRole("heading", { name: "Fim da partida" });
    expect(title).toHaveAccessibleDescription("Errada: SHINee. 1 de 9 casas certas com 9 palpites");
  });

  it("marks each cell right, wrong or empty in the answers", () => {
    const states = sampleCellStates([[0, 0]]);
    states[cellKey(0, 1)] = { solved: false, failed: true, lastAttempt: "SHINee" };
    renderResults({ cellStates: states });
    fireEvent.click(screen.getByRole("button", { name: "Ver fonte" }));

    const items = document.querySelectorAll(".review-item");
    expect(items[0]).toHaveTextContent("Certa");
    expect(items[0]).toHaveTextContent("Sua resposta: TWICE");
    expect(items[1]).toHaveTextContent("Errada");
    expect(items[1]).toHaveTextContent("Sua resposta: SHINee");
    expect(items[2]).toHaveTextContent("Vazia");
    expect(items[2]).toHaveTextContent(`Sua resposta: ${ptMessages.noAnswer}`);
  });

  it("calls onRestart when restart button is clicked, after the guard", () => {
    const onRestart = vi.fn();
    render(
      <GridResults
        grid={validGrid}
        cellStates={sampleCellStates()}
        guessesUsed={9}
        onRestart={onRestart}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const restartBtn = screen.getByRole("button", { name: "Jogar novamente" });
    // A second tap meant for the last pick does nothing.
    clock += RESULT_GUARD_MS - 1;
    fireEvent.click(restartBtn);
    expect(onRestart).not.toHaveBeenCalled();

    clock += 1;
    fireEvent.click(restartBtn);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

describe("cellSources", () => {
  const cell = {
    row_index: 0,
    col_index: 0,
    valid_entity_ids: ["Q1", "Q2"],
    evidence: [
      { fact_base_id: "Q2$a", locator: "extract[0:4]", revision_id: 7, source_key: "wikipedia:en", source_url: "https://en.wikipedia.org/w/index.php?curid=2&oldid=7" },
      { fact_base_id: "Q1$b", locator: "extract[1:5]", revision_id: 5, source_key: "wikipedia:en", source_url: "https://en.wikipedia.org/w/index.php?curid=1&oldid=5" },
      { fact_base_id: "Q1$c", locator: "extract[9:12]", revision_id: 5, source_key: "wikipedia:en", source_url: "https://en.wikipedia.org/w/index.php?curid=1&oldid=5" },
      { fact_base_id: "Q1$d", locator: "claims/P264", revision_id: 9, source_key: "wikidata", source_url: "https://www.wikidata.org/wiki/Special:EntityPage/Q1?oldid=9" },
    ],
  };
  const grid = {
    ...validGrid,
    candidate_pool: [
      { id: "Q1", canonical_name: "One", names: { "pt-BR": "Um", en: "One" } },
      { id: "Q2", canonical_name: "Two", names: { "pt-BR": "Dois", en: "Two" } },
    ],
  };

  it("groups by group and revision, keeps every location and puts the player's group first", () => {
    const sources = cellSources(grid, cell, "pt-BR", "Q1");
    expect(sources.map((g) => g.name)).toEqual(["Um", "Dois"]);
    expect(sources[0]!.lines).toEqual([
      expect.objectContaining({ project: "Wikipedia", revision: 5, locators: ["extract[1:5]", "extract[9:12]"] }),
      expect.objectContaining({ project: "Wikidata", revision: 9, locators: ["claims/P264"] }),
    ]);
    expect(cellSources(grid, cell, "en").map((g) => g.name)).toEqual(["Two", "One"]);
  });
});

describe("readableLocator", () => {
  // Both formats come from public/data/grid.daily.json.
  const extract = "wikipedia:en:pageid=19515908:revid=1375666829#extract[140:148]";
  const claim = "claims/P527/Q492035$c6af000e-44b9-5907-4bfd-e0147407b7ff/references/d6367644222118ee913f72f24c8ac6564ec08025";

  it("names a span of the summary and a Wikidata statement in both languages", () => {
    expect(readableLocator(extract, ptMessages)).toBe("caracteres 140 a 148 do resumo");
    expect(readableLocator(extract, getMessages("en"))).toBe("extract characters 140–148");
    expect(readableLocator(claim, ptMessages)).toBe("declaração P527 e sua referência");
    expect(readableLocator(claim, getMessages("en"))).toBe("statement P527 and its reference");
    expect(readableLocator("page#section-2", ptMessages)).toBe("section-2");
  });

  it("shows the readable place and keeps the raw locator in the title", () => {
    const grid = {
      ...validGrid,
      cells: validGrid.cells.map((cell, i) =>
        i === 0
          ? {
              ...cell,
              evidence: [
                { ...cell.evidence[0]!, locator: extract, source_url: "https://en.wikipedia.org/w/index.php?curid=19515908&oldid=1375666829" },
                { ...cell.evidence[0]!, locator: claim },
              ],
            }
          : cell,
      ),
    };
    render(<GridReview grid={grid} cellStates={sampleCellStates()} locale="pt-BR" messages={ptMessages} />);

    expect(screen.getByTitle(extract)).toHaveTextContent("caracteres 140 a 148 do resumo");
    expect(screen.getByTitle(claim)).toHaveTextContent("declaração P527 e sua referência");
  });
});
