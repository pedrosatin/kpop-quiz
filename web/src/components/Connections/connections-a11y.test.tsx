import { cleanup, render, fireEvent } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/connections.daily.json";
import { getMessages } from "../../i18n/catalog";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { CategoryBanner } from "./CategoryBanner";
import { ConnectionsBoard } from "./ConnectionsBoard";
import { ConnectionsGame } from "./ConnectionsGame";
import { ConnectionsResults } from "./ConnectionsResults";
import { MistakesRemaining } from "./MistakesRemaining";

const puzzle = validPuzzleJson as unknown as ConnectionsPuzzle;
const ptMessages = getMessages("pt-BR");

describe("Automated accessibility audits with axe-core for Connections", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("validates ConnectionsGame in initial state with zero violations", async () => {
    const { container } = render(
      <ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={ptMessages} />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates ConnectionsGame with items selected with zero violations", async () => {
    const { container, getByRole } = render(
      <ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={ptMessages} />
    );

    const twiceBtn = getByRole("button", { name: /TWICE/ });
    const itzyBtn = getByRole("button", { name: /ITZY/ });
    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates CategoryBanner for all 4 difficulty levels with zero violations", async () => {
    for (const category of puzzle.categories) {
      const { container } = render(
        <CategoryBanner
          category={category}
          allItems={puzzle.items}
          items={puzzle.items}
          locale="pt-BR"
          messages={ptMessages}
        />
      );
      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
      cleanup();
    }
  });

  it("validates ConnectionsBoard with a solved banner and remaining items with zero violations", async () => {
    const jypCategory = puzzle.categories.find((c) => c.id === "cat_jyp")!;
    const remainingItems = puzzle.items.filter((i) => !jypCategory.item_ids.includes(i.id));

    const { container } = render(
      <ConnectionsBoard
        categories={puzzle.categories}
        solvedCategoryIds={["cat_jyp"]}
        boardItems={remainingItems}
        allItems={puzzle.items}
        selectedItemIds={[remainingItems[0]!.id]}
        onToggleItem={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates MistakesRemaining component with zero violations", async () => {
    const { container } = render(
      <MistakesRemaining mistakesRemaining={3} messages={ptMessages} />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates ConnectionsResults in victory state with zero violations", async () => {
    const guessHistory = puzzle.categories.map((c) => c.item_ids);
    const { container } = render(
      <ConnectionsResults
        puzzle={puzzle}
        gameStatus="won"
        guessHistory={guessHistory}
        mistakesRemaining={4}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates ConnectionsResults in defeat state with zero violations", async () => {
    const wrongGuesses = [
      [puzzle.items[0]!.id, puzzle.items[4]!.id, puzzle.items[8]!.id, puzzle.items[12]!.id],
      [puzzle.items[1]!.id, puzzle.items[5]!.id, puzzle.items[9]!.id, puzzle.items[13]!.id],
      [puzzle.items[2]!.id, puzzle.items[6]!.id, puzzle.items[10]!.id, puzzle.items[14]!.id],
      [puzzle.items[3]!.id, puzzle.items[7]!.id, puzzle.items[11]!.id, puzzle.items[15]!.id],
    ];
    const { container } = render(
      <ConnectionsResults
        puzzle={puzzle}
        gameStatus="lost"
        guessHistory={wrongGuesses}
        mistakesRemaining={0}
        onRestart={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
