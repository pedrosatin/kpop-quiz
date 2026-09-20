import { cleanup, render, fireEvent, screen } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/word-search.daily.json";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import { WordSearchGame } from "./WordSearchGame";
import { WordSearchEvidenceModal } from "./WordSearchEvidenceModal";
import { WordSearchResultModal } from "./WordSearchResultModal";

const puzzle = validPuzzleJson as unknown as WordSearchPuzzle;

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

    const cell = screen.getByLabelText(/^Linha 1, Coluna 1,/);
    fireEvent.pointerDown(cell);

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates WordSearchEvidenceModal with zero violations", async () => {
    const { container } = render(
      <WordSearchEvidenceModal
        word={puzzle.words[0] ?? null}
        locale="pt-BR"
        onClose={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates WordSearchResultModal with zero violations", async () => {
    const { container } = render(
      <WordSearchResultModal
        puzzle={puzzle}
        locale="pt-BR"
        foundCount={puzzle.words.length}
        totalCount={puzzle.words.length}
        elapsedSeconds={125}
        onClose={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("manages roving tabindex correctly during keyboard navigation", () => {
    render(<WordSearchGame locale="pt-BR" puzzle={puzzle} />);

    const grid = screen.getByRole("grid");
    const cell00 = screen.getByLabelText(/^Linha 1, Coluna 1,/);
    const cell10 = screen.getByLabelText(/^Linha 2, Coluna 1,/);

    expect(cell00).toHaveAttribute("tabindex", "0");
    expect(cell10).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(grid, { key: "ArrowDown" });

    expect(cell00).toHaveAttribute("tabindex", "-1");
    expect(cell10).toHaveAttribute("tabindex", "0");
  });
});
