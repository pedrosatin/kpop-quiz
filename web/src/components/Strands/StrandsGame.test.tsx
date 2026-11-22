import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzle from "../../tests/fixtures/strands.daily.json";
import type { StrandsPuzzle, StrandsWord } from "../../lib/strands-types";
import { getMessages } from "../../i18n/catalog";
import { staleDailyDate } from "../../data/daily-artifact";
import { StrandsGame } from "./StrandsGame";
import { pathFromCells } from "./trail";

const puzzle = validPuzzle as unknown as StrandsPuzzle;
const tPt = getMessages("pt-BR").strands;
const messagesPt = getMessages("pt-BR");

function cell(row: number, col: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!;
}

/** Drive the shared grid handlers with integer cell positions. */
function selectByHandlers(word: StrandsWord) {
  const path = pathFromCells(word.cells);
  const first = path[0]!;
  fireEvent.pointerDown(cell(first.row, first.col), { pointerId: 1, buttons: 1 });
  for (const step of path.slice(1)) {
    fireEvent.pointerMove(cell(step.row, step.col), { pointerId: 1, buttons: 1 });
  }
  const last = path[path.length - 1]!;
  fireEvent.pointerUp(cell(last.row, last.col), { pointerId: 1, buttons: 0 });
}

function press(key: string) {
  const target = document.activeElement ?? screen.getByRole("grid");
  fireEvent.keyDown(target, { key });
}

describe("StrandsGame board", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reveals the theme and tracks progress in text", () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} />);
    expect(screen.getByTestId("strands-theme")).toHaveTextContent(puzzle.theme["pt-BR"]);
    expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(0, puzzle.words.length));
    expect(screen.getByTestId("spangram-status")).toHaveTextContent(tPt.spangramPending);
    expect(screen.getByTestId("progress-announcement")).toHaveTextContent(
      tPt.progressAnnouncement(0, puzzle.words.length, false),
    );
  });

  it("finds the spangram by pointer trail and marks it in text and class", async () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} />);
    const spangram = puzzle.words.find((word) => word.is_spangram)!;
    selectByHandlers(spangram);

    await waitFor(() => {
      expect(screen.getByTestId("found-counter")).toHaveTextContent(tPt.progress(1, puzzle.words.length));
    });
    expect(screen.getByTestId("spangram-status")).toHaveTextContent(tPt.spangramFound);
    const item = document.querySelector(`[data-spangram="true"]`)!;
    expect(item).toHaveClass("is-found");
    expect(item).toHaveClass("is-spangram");
    expect(item).toHaveTextContent(spangram.labels["pt-BR"]);
    expect(item.textContent).toMatch(/spangram encontrado/);
  });

  it("builds a trail with keyboard Space/Enter and cancels with Escape", async () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} />);
    const spangram = puzzle.words.find((word) => word.is_spangram)!;
    const path = pathFromCells(spangram.cells);
    cell(0, 0).focus();

    for (let i = 0; i < path[0]!.row; i++) press("ArrowDown");
    for (let i = 0; i < path[0]!.col; i++) press("ArrowRight");
    press(" ");

    for (const step of path.slice(1)) {
      const focused = document.activeElement as HTMLElement;
      const row = Number(focused.dataset.row);
      const col = Number(focused.dataset.col);
      if (step.row > row) press("ArrowDown");
      else if (step.row < row) press("ArrowUp");
      if (step.col > col) press("ArrowRight");
      else if (step.col < col) press("ArrowLeft");
    }

    press("Enter");

    await waitFor(() => {
      expect(screen.getByTestId("spangram-status")).toHaveTextContent(tPt.spangramFound);
    });

    press(" ");
    press("Escape");
    expect(screen.getByRole("status")).toHaveTextContent(tPt.cancelFeedback);
  });

  it("announces a miss for a wrong three-letter trail", async () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.pointerDown(cell(0, 0), { pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(cell(0, 1), { pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(cell(0, 2), { pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(cell(0, 2), { pointerId: 1 });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/não é uma palavra|ALP/i);
    });
  });
});

describe("StrandsGame load states", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the loading state while the artifact is fetched", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})),
    );
    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    expect(screen.getByTestId("strands-loading")).toHaveTextContent(tPt.loading);
  });

  it("shows missing with retry when the day has no artifact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(tPt.artifactMissing)).toBeInTheDocument();
    });
    expect(screen.getByTestId("game-missing")).toHaveAttribute("data-error-kind", "missing");
    expect(screen.getByTestId("game-retry")).toHaveTextContent(tPt.retry);
  });

  it("shows incompatible when the schema version does not match", async () => {
    const broken = { ...structuredClone(puzzle), schema_version: "kpop-strands-puzzle-v0" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(broken))));
    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(tPt.incompatibleVersion)).toBeInTheDocument();
    });
    expect(screen.getByTestId("game-missing")).toHaveAttribute("data-error-kind", "incompatible");
  });

  it("shows offline when fetch fails with a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(tPt.offline)).toBeInTheDocument();
    });
    expect(screen.getByTestId("game-missing")).toHaveAttribute("data-error-kind", "offline");
  });

  it("shows invalid for a corrupt payload (manifest-style failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ not: "strands" }))),
    );
    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    await waitFor(() => {
      expect(screen.getByText(tPt.loadError)).toBeInTheDocument();
    });
    expect(screen.getByTestId("game-missing")).toHaveAttribute("data-error-kind", "invalid");
  });

  it("shows the stale-board notice when the loaded day is not today", () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} daily />);
    if (staleDailyDate(puzzle)) {
      expect(screen.getByTestId("stale-daily-notice")).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId("stale-daily-notice")).not.toBeInTheDocument();
    }
  });

  it("retries after a missing load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValue(new Response(JSON.stringify(puzzle)));
    vi.stubGlobal("fetch", fetchMock);

    render(<StrandsGame locale="pt-BR" baseUrl="http://localhost:3000" />);
    await waitFor(() => expect(screen.getByTestId("game-retry")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("game-retry"));
    await waitFor(() => {
      expect(screen.getByTestId("game-board")).toBeInTheDocument();
    });
    expect(within(screen.getByTestId("game-board")).getByTestId("strands-theme")).toBeInTheDocument();
  });
});

describe("StrandsGame give up", () => {
  afterEach(() => cleanup());

  it("asks for confirmation before ending the round", async () => {
    render(<StrandsGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: messagesPt.giveUp }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messagesPt.giveUpConfirmTitle);
    fireEvent.click(screen.getByRole("button", { name: messagesPt.giveUpConfirmAction }));
    await waitFor(() => {
      expect(screen.getByTestId("game-result")).toBeInTheDocument();
    });
  });
});
