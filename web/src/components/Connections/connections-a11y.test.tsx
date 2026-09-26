import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, fireEvent } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/connections.daily.json";
import { getMessages } from "../../i18n/catalog";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { CategoryBanner } from "./CategoryBanner";
import { ConnectionsBoard, fitTileText } from "./ConnectionsBoard";
import { ConnectionsGame } from "./ConnectionsGame";
import { ConnectionsResults } from "./ConnectionsResults";
import { tileNameParts } from "./ConnectionsTile";
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

  it("colors CategoryBanner through a level class instead of inline styles", () => {
    for (const category of puzzle.categories) {
      const { getByRole, unmount } = render(
        <CategoryBanner category={category} allItems={puzzle.items} locale="pt-BR" messages={ptMessages} />
      );
      const banner = getByRole("region");
      expect(banner).toHaveClass(`connections-banner-level-${category.difficulty_level}`);
      expect(banner).not.toHaveAttribute("style");
      unmount();
    }
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

  it("validates the result with the source panel open with zero violations", async () => {
    const guessHistory = puzzle.categories.map((c) => c.item_ids);
    const { container, getByRole } = render(
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
    fireEvent.click(getByRole("button", { name: ptMessages.showSource }));
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe("fitTileText", () => {
  // A fake layout: the text is as wide as its font size times its length.
  function fakeTile(chars: number, width: number, height = 60) {
    const tile = document.createElement("button");
    const text = document.createElement("span");
    text.className = "connections-tile-text";
    tile.append(text);
    Object.defineProperty(tile, "clientHeight", { value: height });
    Object.defineProperty(text, "clientWidth", { value: width });
    Object.defineProperty(text, "scrollWidth", { configurable: true, get: () => parseFloat(text.style.fontSize) * 0.6 * chars });
    Object.defineProperty(text, "offsetHeight", { get: () => parseFloat(text.style.fontSize) * 1.2 });
    return { tile, text };
  }

  it("keeps the largest size when the name fits", () => {
    const { tile, text } = fakeTile(5, 140);
    fitTileText(tile, 16);
    expect(text.style.fontSize).toBe("15px");
    expect(text).not.toHaveClass("is-broken");
  });

  it("shrinks a long word until it fits", () => {
    const { tile, text } = fakeTile(10, 80);
    fitTileText(tile, 16);
    const size = parseFloat(text.style.fontSize);
    expect(size).toBeLessThan(15);
    expect(size * 0.6 * 10).toBeLessThanOrEqual(80.5);
    expect(text).not.toHaveClass("is-broken");
  });

  it("uses the break points after punctuation before breaking inside a word", () => {
    const { tile, text } = fakeTile(15, 70);
    const breakMark = document.createElement("span");
    breakMark.className = "connections-tile-break";
    text.append(breakMark);
    // With the break points on, the widest piece is 9 characters.
    Object.defineProperty(text, "scrollWidth", {
      get: () => parseFloat(text.style.fontSize) * 0.6 * (text.classList.contains("has-breaks") ? 9 : 15),
    });
    fitTileText(tile, 16);
    expect(text).toHaveClass("has-breaks");
    expect(text).not.toHaveClass("is-broken");
    expect(parseFloat(text.style.fontSize) * 0.6 * 9).toBeLessThanOrEqual(70.5);
  });

  it("splits names after punctuation only", () => {
    expect(tileNameParts("DAILY:DIRECTION")).toEqual(["DAILY:", "DIRECTION"]);
    expect(tileNameParts("G-Friend")).toEqual(["G-", "Friend"]);
    expect(tileNameParts("Kiss of Life")).toEqual(["Kiss of Life"]);
    expect(tileNameParts("Mr. Mr.")).toEqual(["Mr. Mr."]);
    expect(tileNameParts("a/b.c")).toEqual(["a/", "b.", "c"]);
    expect(tileNameParts("a:-b")).toEqual(["a:", "-", "b"]);
    expect(tileNameParts("END:")).toEqual(["END:"]);
  });

  // Safari before 16.4 cannot parse lookbehind; one in a module breaks the
  // whole chunk, not just the function that uses it.
  it("keeps lookbehind out of the Connections modules", () => {
    // vitest runs from web/.
    const dir = join(process.cwd(), "src/components/Connections");
    const lookbehind = ["(?" + "<=", "(?" + "<!"];
    const modules = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(modules).toContain("ConnectionsTile.tsx");
    for (const file of modules) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const token of lookbehind) expect(source.includes(token), `${file} uses ${token}`).toBe(false);
    }
  });

  it("lets a word break inside only below the smallest size", () => {
    const { tile, text } = fakeTile(14, 70);
    fitTileText(tile, 16);
    expect(text.style.fontSize).toBe("11px");
    expect(text).toHaveClass("is-broken");
  });
});

describe("ConnectionsBoard text fitting", () => {
  const items = puzzle.items.slice(0, 4);
  let observers: Array<() => void> = [];

  function renderBoard(boardItems = items) {
    return (
      <ConnectionsBoard
        categories={puzzle.categories}
        solvedCategoryIds={[]}
        boardItems={boardItems}
        allItems={puzzle.items}
        selectedItemIds={[]}
        onToggleItem={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );
  }

  // jsdom has no layout, so every name "fits" at the largest size; clearing
  // the size shows whether a later pass ran.
  function clearSizes(container: Element): HTMLElement[] {
    const texts = [...container.querySelectorAll<HTMLElement>(".connections-tile-text")];
    texts.forEach((t) => (t.style.fontSize = ""));
    return texts;
  }

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  function stubFonts() {
    let resolve!: () => void;
    const ready = new Promise<void>((r) => (resolve = r));
    Object.defineProperty(document, "fonts", { configurable: true, value: { status: "loading", ready } });
    return () => {
      resolve();
      return ready.then(() => undefined);
    };
  }

  it("fits the names again once the web font has loaded", async () => {
    const fontsLoaded = stubFonts();
    const { container } = render(renderBoard());
    const texts = clearSizes(container);
    await fontsLoaded();
    texts.forEach((t) => expect(t.style.fontSize).toBe("15px"));
  });

  it("does not fit after the board is gone", async () => {
    const fontsLoaded = stubFonts();
    const { container, unmount } = render(renderBoard());
    const texts = clearSizes(container);
    unmount();
    await fontsLoaded();
    texts.forEach((t) => expect(t.style.fontSize).toBe(""));
  });

  it("works without document.fonts", () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
    const { container } = render(renderBoard());
    container.querySelectorAll<HTMLElement>(".connections-tile-text").forEach((t) => expect(t.style.fontSize).toBe("15px"));
  });

  it("skips the resize callback that reports the mounted size, then refits", () => {
    const { container } = render(renderBoard());
    const texts = clearSizes(container);
    observers.at(-1)!();
    texts.forEach((t) => expect(t.style.fontSize).toBe(""));
    observers.at(-1)!();
    texts.forEach((t) => expect(t.style.fontSize).toBe("15px"));
  });

  it("keeps the fit when Shuffle only reorders the tiles", () => {
    const { container, rerender } = render(renderBoard());
    const count = observers.length;
    const texts = clearSizes(container);
    rerender(renderBoard([...items].reverse()));
    expect(observers).toHaveLength(count);
    texts.forEach((t) => expect(t.style.fontSize).toBe(""));
  });
});
