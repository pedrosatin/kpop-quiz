import { cleanup, render, fireEvent, screen } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchGame } from "./WordSearchGame";
import { getMessages } from "../../i18n/catalog";

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;
const pt = getMessages("pt-BR");

describe("Automated accessibility audits with axe-core for WordSearch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("validates WordSearchGame in initial state with zero violations", async () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates WordSearchGame during word selection with zero violations", async () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const cell = screen.getByLabelText(/^Linha 1, coluna 1,/);
    fireEvent.pointerDown(cell);

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates the found-word verdict in the bar with zero violations", async () => {
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    const word = puzzle.words[0]!;
    fireEvent.pointerDown(screen.getByLabelText(new RegExp(`^Linha ${word.start_row + 1}, coluna ${word.start_col + 1},`)));
    fireEvent.pointerUp(screen.getByLabelText(new RegExp(`^Linha ${word.end_row + 1}, coluna ${word.end_col + 1},`)));

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates the result and its open sources with zero violations", async () => {
    localStorage.setItem(
      `kpop-word-search-${puzzle.puzzle_id}`,
      JSON.stringify({ foundWordIds: puzzle.words.map((w) => w.id), elapsedSeconds: 125, status: "completed", easyMode: false }),
    );
    const { container } = render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: pt.showSource }));

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("manages roving tabindex correctly during keyboard navigation", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const grid = screen.getByRole("grid");
    const cell00 = screen.getByLabelText(/^Linha 1, coluna 1,/);
    const cell10 = screen.getByLabelText(/^Linha 2, coluna 1,/);

    expect(cell00).toHaveAttribute("tabindex", "0");
    expect(cell10).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(grid, { key: "ArrowDown" });

    expect(cell00).toHaveAttribute("tabindex", "-1");
    expect(cell10).toHaveAttribute("tabindex", "0");
  });
});
