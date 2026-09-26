import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CELL_GUARD_MS, IntersectionGrid, nextCellAfterGuess } from "./IntersectionGrid";
import { RESULT_GUARD_MS } from "./GridResults";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import { loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";
import validGridJson from "../../tests/fixtures/grid.daily.json";
import { cellKey, type GridCellState } from "./types";

const ptMessages = getMessages("pt-BR");
const STORAGE_KEY = `kpop-grid-${validGridJson.grid_id}`;
const MATCH_ID = `grid-${validGridJson.reference_date}`;

// One right group per cell, none repeated.
const WIN_PATH: [number, number, string][] = [
  [0, 0, "TWICE"],
  [0, 1, "EXO"],
  [0, 2, "WINNER"],
  [1, 0, "Wonder Girls"],
  [1, 1, "SHINee"],
  [1, 2, "BIGBANG"],
  [2, 0, "Miss A"],
  [2, 1, "aespa"],
  [2, 2, "BLACKPINK"],
];

let clock = 0;

function cellButton(row: number, col: number): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.grid-cell-btn[data-row="${row}"][data-col="${col}"]`)!;
}

function status(): HTMLElement {
  return document.querySelector<HTMLElement>(".game-actions-message")!;
}

/** A click from a pointer; Enter and Space give detail 0. */
function tap(element: Element) {
  fireEvent.click(element, { detail: 1 });
}

/** Opens a cell and picks a group, as a player would with time between taps. */
function pick(row: number, col: number, name: string) {
  clock += CELL_GUARD_MS + 1;
  tap(cellButton(row, col));
  fireEvent.click(within(screen.getByRole("dialog")).getByText(name));
}

function emptyCells(): Record<string, GridCellState> {
  const cells: Record<string, GridCellState> = {};
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells[cellKey(r, c)] = { solved: false, failed: false };
  return cells;
}

async function renderReady() {
  const view = render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);
  await waitFor(() => expect(screen.getByRole("grid")).toBeInTheDocument());
  return view;
}

describe("IntersectionGrid orchestrator component", () => {
  beforeEach(() => {
    localStorage.clear();
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(validGridJson)))
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows loading state then reveals 3x3 board with row and col criteria", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    expect(screen.getByText(ptMessages.loading)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("grid", { name: "Grade de interseções" })).toBeInTheDocument();
    });

    expect(screen.getByText("9 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("0 de 9 casas certas")).toBeInTheDocument();

    expect(screen.getByText("Estreou nos anos 2010")).toBeInTheDocument();
    expect(screen.getByText("Estreou nos anos 2000")).toBeInTheDocument();
    expect(screen.getByText("4 integrantes")).toBeInTheDocument();
    expect(screen.getByText("JYP Entertainment")).toBeInTheDocument();
    expect(screen.getByText("SM Entertainment")).toBeInTheDocument();
    expect(screen.getByText("YG Entertainment")).toBeInTheDocument();
  });

  it("keeps the counters and the instructions in the action bar, below the board", async () => {
    await renderReady();

    const bar = document.querySelector<HTMLElement>(".game-actions")!;
    const board = screen.getByRole("grid");
    expect(board.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByText("9 palpites restantes")).toBeInTheDocument();
    expect(within(bar).getByText("0 de 9 casas certas")).toBeInTheDocument();

    // The live region is mounted with the instructions; the counters stay out of it.
    expect(status()).toHaveAttribute("role", "status");
    expect(status()).toHaveAttribute("aria-live", "polite");
    expect(status()).toHaveTextContent(ptMessages.gridHint);
    expect(status()).not.toHaveTextContent("9 palpites restantes");
  });

  it("handles fetch error and allows retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    );

    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByText(ptMessages.artifactMissing)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: ptMessages.retry });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(validGridJson)))
    );

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByRole("grid", { name: "Grade de interseções" })).toBeInTheDocument();
    });
  });

  it("opens entity picker when clicking an empty cell and closes it", async () => {
    await renderReady();

    const cellBtn = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    fireEvent.click(cellBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Escolha um grupo")).toBeInTheDocument();

    const closeBtn = screen.getByLabelText("Fechar");
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cellBtn).toHaveFocus();
  });

  it("moves focus into the picker and back to the cell when it closes", async () => {
    await renderReady();

    const cellBtn = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    cellBtn.focus();
    fireEvent.click(cellBtn);

    expect(screen.getByRole("combobox")).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cellBtn).toHaveFocus();
  });

  it("submits a correct guess, announces it and moves focus to the next open cell", async () => {
    await renderReady();

    // Cell (0, 0): 2010s + JYP -> TWICE is valid
    pick(0, 0, "TWICE");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("1 de 9 casas certas")).toBeInTheDocument();
    expect(within(screen.getByRole("grid")).getByText("TWICE")).toBeInTheDocument();

    expect(status()).toHaveTextContent("Certa: TWICE.");
    expect(status()).toHaveTextContent("8 palpites restantes. 1 de 9 casas certas.");
    expect(document.querySelector(".game-actions")).toHaveClass("is-correct");
    await waitFor(() => expect(cellButton(0, 1)).toHaveFocus());
  });

  it("keeps a solved cell focusable but closed to new guesses", async () => {
    await renderReady();
    pick(0, 0, "TWICE");

    const solved = cellButton(0, 0);
    expect(solved).not.toBeDisabled();
    expect(solved).toHaveAttribute("aria-disabled", "true");
    expect(solved).toHaveAccessibleName(/Certa: TWICE/);

    clock += CELL_GUARD_MS + 1;
    fireEvent.click(solved);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The arrow keys walk through the solved cell.
    cellButton(0, 1).focus();
    fireEvent.keyDown(cellButton(0, 1), { key: "ArrowLeft" });
    expect(solved).toHaveFocus();
  });

  it("submits an incorrect guess, announces it and keeps focus on the cell", async () => {
    await renderReady();

    // Cell (0, 0): 2010s + JYP -> SHINee is invalid (SM)
    pick(0, 0, "SHINee");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("0 de 9 casas certas")).toBeInTheDocument();
    expect(within(screen.getByRole("grid")).getByText("SHINee")).toBeInTheDocument();

    expect(status()).toHaveTextContent("Errada: SHINee. 8 palpites restantes. 0 de 9 casas certas.");
    expect(document.querySelector(".game-actions")).toHaveClass("is-incorrect");
    await waitFor(() => expect(cellButton(0, 0)).toHaveFocus());
    expect(cellButton(0, 0)).toHaveAttribute("aria-disabled", "false");
  });

  it("ignores a tap on the board right after a guess closes the picker", async () => {
    await renderReady();

    tap(cellButton(0, 0));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("TWICE"));

    // The second tap of a double tap lands on the cell under the list.
    clock += CELL_GUARD_MS - 1;
    tap(cellButton(1, 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    clock += 2;
    tap(cellButton(1, 1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the focused cell from the keyboard right after a guess", async () => {
    await renderReady();

    tap(cellButton(0, 0));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("SHINee"));
    await waitFor(() => expect(cellButton(0, 0)).toHaveFocus());

    // Enter on a button fires a click with detail 0, inside the guard time.
    fireEvent.click(cellButton(0, 0), { detail: 0 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not open a cell on a held Enter", async () => {
    await renderReady();

    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    cellButton(1, 1).dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it("enforces uniqueness: forbids using already chosen group in another cell", async () => {
    await renderReady();

    // Cell (0, 0): choose TWICE (correct)
    pick(0, 0, "TWICE");

    await waitFor(() => {
      expect(screen.getByText("1 de 9 casas certas")).toBeInTheDocument();
    });

    // Cell (0, 1): try to pick TWICE again
    pick(0, 1, "TWICE");

    // Should NOT close dialog and should display uniqueness error
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("TWICE: este grupo já está em outra casa.");
    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
  });

  it("finishes game when all 9 guesses are consumed and focuses the result title", async () => {
    await renderReady();

    // Make 9 incorrect guesses
    for (let i = 0; i < 9; i++) pick(0, 0, "SHINee");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fim da partida" })).toBeInTheDocument();
    });

    const title = screen.getByRole("heading", { name: "Fim da partida" });
    // The verdict of the last guess opens the summary.
    expect(title).toHaveAccessibleDescription("Errada: SHINee. 0 de 9 casas certas com 9 palpites");
    await waitFor(() => expect(title).toHaveFocus());
    // The result sits in the action bar, and the kicker of the intro is not repeated.
    expect(title.closest(".game-actions")).not.toBeNull();
    expect(screen.queryByText(ptMessages.gridEyebrow)).not.toBeInTheDocument();
    // The finished board stays on screen.
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(cellButton(1, 1)).toHaveAttribute("aria-disabled", "true");

    const stats = loadPlayerStats().games.grid;
    expect(stats.played).toBe(1);
    expect(stats.won).toBe(0);
  });

  it("wins with nine right groups and counts the game once", async () => {
    await renderReady();

    for (const [row, col, name] of WIN_PATH) pick(row, col, name);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Fim da partida" })).toHaveFocus());
    expect(screen.getByText("Certa: BLACKPINK. 9 de 9 casas certas com 9 palpites")).toBeInTheDocument();
    expect(loadPlayerStats().games.grid).toMatchObject({ played: 1, won: 1 });
  });

  it("saves the board after each guess", async () => {
    await renderReady();
    pick(0, 0, "TWICE");
    clock += CELL_GUARD_MS + 1;
    pick(1, 1, "TWICE");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    pick(1, 1, "EXO");

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.guessesUsed).toBe(2);
    expect(saved.cells["0,0"]).toMatchObject({ solved: true, entityId: "Q21461452" });
    expect(saved.cells["1,1"]).toEqual({ solved: false, failed: true, lastAttemptId: "Q494217" });
    expect(saved.cells["0,0"]).not.toHaveProperty("entityName");
  });

  it("does not save an untouched board", async () => {
    await renderReady();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    pick(0, 0, "SHINee");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).guessesUsed).toBe(1);
  });

  it("names the wrong group in the page's language after the language changes", async () => {
    const grid = structuredClone(validGridJson);
    const shinee = grid.candidate_pool.find((c) => c.id === "Q243884")!;
    shinee.names = { "pt-BR": "SHINee (pt)", en: "SHINee (en)" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(grid)))));

    const view = render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);
    await screen.findByRole("grid");
    pick(0, 0, "SHINee (pt)");
    expect(within(screen.getByRole("grid")).getByText("SHINee (pt)")).toBeInTheDocument();

    const en: Locale = "en";
    view.rerender(<IntersectionGrid locale={en} messages={getMessages(en)} />);
    await waitFor(() => expect(within(screen.getByRole("grid")).getByText("SHINee (en)")).toBeInTheDocument());
    expect(cellButton(0, 0)).toHaveAccessibleName(/Wrong: you tried SHINee \(en\)/);
    expect(screen.queryByText("SHINee (pt)")).not.toBeInTheDocument();
  });

  it("drops a save whose wrong group is not in the pool", async () => {
    const cells = emptyCells();
    cells["1,1"] = { solved: false, failed: true, lastAttemptId: "Q999999999" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guessesUsed: 1, cells }));

    await renderReady();

    expect(screen.getByText("9 palpites restantes")).toBeInTheDocument();
    expect(cellButton(1, 1)).toHaveAccessibleName(/Vazia/);
  });

  it("restores a game in progress without moving focus", async () => {
    const cells = emptyCells();
    cells["0,0"] = { solved: true, failed: false, entityId: "Q21461452" };
    cells["1,1"] = { solved: false, failed: true, lastAttemptId: "Q494217" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guessesUsed: 3, cells }));

    await renderReady();

    expect(screen.getByText("6 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("1 de 9 casas certas")).toBeInTheDocument();
    expect(cellButton(0, 0)).toHaveAttribute("aria-disabled", "true");
    expect(cellButton(1, 1)).toHaveAccessibleName(/Errada: você tentou EXO/);
    expect(document.body).toHaveFocus();
    expect(status()).toHaveTextContent(ptMessages.gridHint);
  });

  it("restores a finished game without stealing focus or counting it again", async () => {
    const cells = emptyCells();
    for (const [row, col] of WIN_PATH.slice(0, 4)) {
      cells[cellKey(row, col)] = { solved: false, failed: true, lastAttemptId: "Q243884" };
    }
    cells["0,0"] = { solved: true, failed: false, entityId: "Q21461452" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guessesUsed: 9, cells }));
    markGameMatchRecorded("grid", MATCH_ID);
    const before = JSON.stringify(loadPlayerStats());

    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    const title = await screen.findByRole("heading", { name: "Fim da partida" });
    expect(title).toHaveAccessibleDescription("1 de 9 casas certas com 9 palpites");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(title).not.toHaveFocus();
    expect(document.body).toHaveFocus();
    expect(JSON.stringify(loadPlayerStats())).toBe(before);
  });

  it("drops a save that names a group the cell does not accept", async () => {
    const cells = emptyCells();
    // BLACKPINK is not a JYP group of the 2010s.
    cells["0,0"] = { solved: true, failed: false, entityId: "Q25056705" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guessesUsed: 1, cells }));

    await renderReady();

    expect(screen.getByText("9 palpites restantes")).toBeInTheDocument();
    expect(within(screen.getByRole("grid")).queryByText("BLACKPINK")).not.toBeInTheDocument();
  });

  it("starts over from Play again, clears the save and focuses the first cell", async () => {
    await renderReady();
    for (let i = 0; i < 9; i++) pick(0, 0, "SHINee");
    await screen.findByRole("heading", { name: "Fim da partida" });

    clock += RESULT_GUARD_MS;
    fireEvent.click(screen.getByRole("button", { name: "Jogar novamente" }));

    expect(screen.getByText("9 palpites restantes")).toBeInTheDocument();
    await waitFor(() => expect(cellButton(0, 0)).toHaveFocus());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("counts a restored finished game that was not counted yet, once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(validGridJson)))));
    const cells = emptyCells();
    cells["0,0"] = { solved: true, failed: false, entityId: "Q21461452" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guessesUsed: 9, cells }));

    const first = render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);
    await screen.findByRole("heading", { name: "Fim da partida" });
    await waitFor(() => expect(loadPlayerStats().games.grid.played).toBe(1));
    expect(loadPlayerStats().games.grid.won).toBe(0);
    first.unmount();

    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);
    await screen.findByRole("heading", { name: "Fim da partida" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadPlayerStats().games.grid.played).toBe(1);
  });
});

describe("nextCellAfterGuess", () => {
  it("keeps an open cell, and skips to the next empty cell after a solved one", () => {
    const cells = emptyCells();
    expect(nextCellAfterGuess(cells, 1, 1)).toEqual({ row: 1, col: 1 });

    cells["1,1"] = { solved: true, failed: false };
    cells["1,2"] = { solved: false, failed: true };
    cells["2,0"] = { solved: true, failed: false };
    expect(nextCellAfterGuess(cells, 1, 1)).toEqual({ row: 2, col: 1 });
  });

  it("falls back to a failed cell, wrapping to the top, and to none when all are solved", () => {
    const cells = emptyCells();
    for (const key of Object.keys(cells)) cells[key] = { solved: true, failed: false };
    cells["0,1"] = { solved: false, failed: true };
    expect(nextCellAfterGuess(cells, 2, 2)).toEqual({ row: 0, col: 1 });

    cells["0,1"] = { solved: true, failed: false };
    expect(nextCellAfterGuess(cells, 2, 2)).toBeNull();
  });
});
