import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GAME_ACTIONS_HEIGHT_VAR,
  coveredAtBottom,
  findStickyBar,
  growthScroll,
  installStickyBarSpace,
} from "./sticky-bar-space";

type Box = { top: number; height: number };

/** jsdom has no layout: each element answers the box the test gives it. */
const boxes = new Map<Element, Box>();

function rectOf(el: Element): DOMRect {
  const box = boxes.get(el) ?? { top: 0, height: 0 };
  return { top: box.top, bottom: box.top + box.height, height: box.height, left: 0, right: 100, width: 100, x: 0, y: box.top, toJSON() {} } as DOMRect;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const flushMutations = () => new Promise<void>((resolve) => setTimeout(resolve));

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (boxes.has(this) ? [rectOf(this)] : []) as unknown as DOMRectList;
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

afterEach(() => {
  vi.restoreAllMocks();
  boxes.clear();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** A game page: a board with a cell, then the sticky bar with a button. */
function mountGame({ sticky = true } = {}) {
  document.body.innerHTML = `
    <main>
      <div class="board"><button class="cell">A</button></div>
      <div class="game-actions" style="position: ${sticky ? "sticky" : "static"}">
        <p class="game-actions-message">Hint</p>
        <button class="action">Check</button>
      </div>
    </main>`;
  const bar = document.querySelector<HTMLElement>(".game-actions")!;
  const cell = document.querySelector<HTMLElement>(".cell")!;
  const action = document.querySelector<HTMLElement>(".action")!;
  boxes.set(bar, { top: 650, height: 150 });
  boxes.set(cell, { top: 600, height: 44 });
  boxes.set(action, { top: 700, height: 44 });
  return { bar, cell, action };
}

describe("growthScroll", () => {
  it("returns what a grown, stuck bar took from the content", () => {
    expect(growthScroll({ top: 650, height: 150 }, { top: 600, height: 200 })).toBe(50);
  });

  it("ignores a bar that grew downward from its place in the page", () => {
    expect(growthScroll({ top: 400, height: 150 }, { top: 400, height: 200 })).toBe(0);
  });

  it("ignores a bar that shrank or kept its height", () => {
    expect(growthScroll({ top: 600, height: 200 }, { top: 650, height: 150 })).toBe(0);
    expect(growthScroll({ top: 650, height: 150 }, { top: 500, height: 150 })).toBe(0);
  });
});

describe("coveredAtBottom", () => {
  it("is true for an element that reaches past the visible edge", () => {
    expect(coveredAtBottom({ top: 620, bottom: 664, height: 44 }, 650)).toBe(true);
  });

  it("is false for an element above the edge", () => {
    expect(coveredAtBottom({ top: 600, bottom: 650, height: 50 }, 650)).toBe(false);
  });

  it("leaves alone an element taller than the room above the edge", () => {
    expect(coveredAtBottom({ top: 0, bottom: 900, height: 900 }, 650)).toBe(false);
  });
});

describe("findStickyBar", () => {
  it("finds the rendered sticky bar", () => {
    const { bar } = mountGame();
    expect(findStickyBar(document)).toBe(bar);
  });

  it("skips a bar that is not sticky", () => {
    mountGame({ sticky: false });
    expect(findStickyBar(document)).toBeNull();
  });
});

describe("installStickyBarSpace", () => {
  it("publishes the sticky bar's height and removes it on stop", () => {
    mountGame();
    const stop = installStickyBarSpace(document);
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("150px");
    stop();
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("");
  });

  it("publishes nothing while the bar is not sticky", () => {
    mountGame({ sticky: false });
    const stop = installStickyBarSpace(document);
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("");
    stop();
  });

  it("scrolls by what the stuck bar took when a message grows it", async () => {
    const { bar } = mountGame();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const stop = installStickyBarSpace(document);
    boxes.set(bar, { top: 600, height: 200 });
    bar.querySelector(".game-actions-message")!.append(document.createElement("p"));
    await flushMutations();
    expect(scrollBy).toHaveBeenCalledWith(0, 50);
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("200px");
    stop();
  });

  it("does not scroll when the window resize grew the bar", () => {
    const { bar } = mountGame();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const stop = installStickyBarSpace(document);
    boxes.set(bar, { top: 600, height: 200 });
    window.dispatchEvent(new Event("resize"));
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("200px");
    stop();
  });

  it("does not scroll when a different bar replaces the old one", async () => {
    mountGame();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const stop = installStickyBarSpace(document);
    const { bar } = mountGame();
    boxes.set(bar, { top: 500, height: 300 });
    await flushMutations();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue(GAME_ACTIONS_HEIGHT_VAR)).toBe("300px");
    stop();
  });

  it("scrolls a focused element that sits behind the bar into view", async () => {
    const { cell } = mountGame();
    boxes.set(cell, { top: 620, height: 44 });
    const scrollIntoView = vi.fn();
    cell.scrollIntoView = scrollIntoView;
    const stop = installStickyBarSpace(document);
    cell.focus();
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    stop();
  });

  it("leaves focus above the bar where it is", async () => {
    const { cell } = mountGame();
    boxes.set(cell, { top: 500, height: 44 });
    const scrollIntoView = vi.fn();
    cell.scrollIntoView = scrollIntoView;
    const stop = installStickyBarSpace(document);
    cell.focus();
    await nextFrame();
    expect(scrollIntoView).not.toHaveBeenCalled();
    stop();
  });

  it("never scrolls for focus inside the bar", async () => {
    const { action } = mountGame();
    const scrollIntoView = vi.fn();
    action.scrollIntoView = scrollIntoView;
    const stop = installStickyBarSpace(document);
    action.focus();
    await nextFrame();
    expect(scrollIntoView).not.toHaveBeenCalled();
    stop();
  });

  it("measures the open consent banner as the edge when it sits higher", async () => {
    const { cell } = mountGame();
    boxes.set(cell, { top: 520, height: 44 });
    const banner = document.createElement("div");
    banner.className = "consent-banner";
    document.body.append(banner);
    boxes.set(banner, { top: 540, height: 260 });
    const scrollIntoView = vi.fn();
    cell.scrollIntoView = scrollIntoView;
    const stop = installStickyBarSpace(document);
    cell.focus();
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    stop();
  });
});
