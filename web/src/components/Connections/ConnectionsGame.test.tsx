import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/connections.daily.json";
import { getMessages } from "../../i18n/catalog";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { ConnectionsGame, SUBMIT_GUARD_MS } from "./ConnectionsGame";
import { RESULT_GUARD_MS, generateShareText } from "./ConnectionsResults";
import { loadPlayerStats, markGameMatchRecorded } from "../../lib/player-stats";

const puzzle = validPuzzleJson as unknown as ConnectionsPuzzle;
const pt = getMessages("pt-BR");

function labelOf(id: string): string {
  const item = puzzle.items.find((i) => i.id === id)!;
  return item.labels["pt-BR"] || item.canonical_name;
}

function tile(id: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${labelOf(id)},`) });
}

function categoryIds(id: string): string[] {
  return puzzle.categories.find((c) => c.id === id)!.item_ids;
}

// Advances the clock past the Submit guard, then sends the four names.
let clock = 1000;
function guess(ids: string[]): void {
  ids.forEach((id) => fireEvent.click(tile(id)));
  clock += SUBMIT_GUARD_MS + 1;
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
}

function renderGame() {
  return render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={pt} />);
}

const oneAway = [...categoryIds("cat_jyp").slice(0, 3), categoryIds("cat_sm")[0]!];

describe("ConnectionsGame component integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders 16 tiles and controls in pt-BR", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    expect(screen.getByText("4 erros restantes")).toBeInTheDocument();
    expect(screen.getByText("Embaralhar")).toBeInTheDocument();
    expect(screen.getByText("Limpar seleção")).toBeInTheDocument();
    expect(screen.getByText("Enviar")).toBeInTheDocument();

    // Check that TWICE tile exists
    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    expect(twiceBtn).toBeInTheDocument();
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("renders in English locale when specified", () => {
    const messages = getMessages("en");
    render(<ConnectionsGame locale="en" puzzle={puzzle} messages={messages} />);

    expect(screen.getByText("4 mistakes left")).toBeInTheDocument();
    expect(screen.getByText("Shuffle")).toBeInTheDocument();
    expect(screen.getByText("Clear selection")).toBeInTheDocument();
    expect(screen.getByText("Submit")).toBeInTheDocument();
  });

  it("allows selecting and deselecting tiles via click", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(twiceBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(twiceBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("deselects all selected items when clicking Desmarcar tudo", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "true");
    expect(itzyBtn).toHaveAttribute("aria-pressed", "true");

    const deselectBtn = screen.getByText("Limpar seleção");
    fireEvent.click(deselectBtn);

    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
    expect(itzyBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows solved category banner when correct 4 items are submitted", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });
    const skzBtn = screen.getByRole("button", { name: /Stray Kids/ });
    const wgBtn = screen.getByRole("button", { name: /Wonder Girls/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    fireEvent.click(skzBtn);
    fireEvent.click(wgBtn);

    const submitBtn = screen.getByText("Enviar");
    fireEvent.click(submitBtn);

    expect(screen.getByText("Grupos da JYP Entertainment")).toBeInTheDocument();
    expect(screen.getByText(/Todos os grupos foram formados e gerenciados pela JYP/)).toBeInTheDocument();
    expect(screen.getByText("TWICE, ITZY, Stray Kids, Wonder Girls")).toBeInTheDocument();
  });

  it("shows proximity banner when guess is one away", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    // 3 JYP + 1 SM
    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });
    const skzBtn = screen.getByRole("button", { name: /Stray Kids/ });
    const exoBtn = screen.getByRole("button", { name: /EXO/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    fireEvent.click(skzBtn);
    fireEvent.click(exoBtn);

    const submitBtn = screen.getByText("Enviar");
    fireEvent.click(submitBtn);

    expect(screen.getByText("Quase. 3 desses nomes são da mesma categoria.")).toBeInTheDocument();
    expect(screen.getByText("3 erros restantes")).toBeInTheDocument();
  });

  it("handles async loading lifecycle when puzzle prop is omitted", async () => {
    const messages = getMessages("pt-BR");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(puzzle))));

    render(<ConnectionsGame locale="pt-BR" />);

    expect(screen.getByText(messages.loading)).toBeInTheDocument();

    const twiceBtn = await screen.findByRole("button", { name: /TWICE/ });
    expect(twiceBtn).toBeInTheDocument();

    for (const item of puzzle.items) {
      const label = item.labels["pt-BR"] || item.canonical_name;
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(twiceBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps Shuffle, Clear and Submit in the action bar, Submit last", () => {
    const { container } = renderGame();
    const bar = container.querySelector(".game-actions")!;
    expect(bar).not.toBeNull();
    const buttons = within(bar as HTMLElement).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Embaralhar", "Limpar seleção", "Enviar"]);
    expect(buttons[2]).toHaveClass("btn-primary");
    // The live region is mounted before the first guess and holds no button.
    const live = bar.querySelector(".game-actions-message")!;
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live.querySelector("button")).toBeNull();
    expect(live).toHaveTextContent(pt.connectionsHint);
  });

  it("shows a wrong guess in the bar's live region and leaves the board as it was", () => {
    const { container } = renderGame();
    const board = container.querySelector(".connections-board")!;
    const tilesBefore = [...board.querySelectorAll(".connections-tile")];
    const boardBefore = board.previousElementSibling;

    guess(oneAway);

    const live = container.querySelector(".game-actions-message")!;
    expect(live).toHaveTextContent(pt.connectionsOneAway);
    // Nothing was inserted above the board, and the same tiles keep their order.
    expect(board.previousElementSibling).toBe(boardBefore);
    expect(container.querySelector(".alert-warning")).toBeNull();
    expect([...board.querySelectorAll(".connections-tile")]).toEqual(tilesBefore);
    expect(board.nextElementSibling).toHaveClass("game-actions");
    expect(container.querySelector(".game-actions")).toHaveClass("is-incorrect");

    // A guess that is not one away says so in text too.
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    guess([categoryIds("cat_jyp")[0]!, categoryIds("cat_sm")[0]!, categoryIds("cat_yg")[0]!, categoryIds("cat_debut_2020s")[0]!]);
    expect(live).toHaveTextContent(pt.connectionsWrong);
    expect(screen.getByText("2 erros restantes")).toBeInTheDocument();
  });

  it("clears the verdict when the player picks a tile again", () => {
    const { container } = renderGame();
    guess(oneAway);
    fireEvent.click(tile(oneAway[3]!));
    const live = container.querySelector(".game-actions-message")!;
    expect(live).toHaveTextContent(pt.connectionsHint);
    expect(container.querySelector(".game-actions")).not.toHaveClass("is-incorrect");
  });

  it("moves focus to the first tile left after a solved category", () => {
    const { container } = renderGame();
    guess(categoryIds("cat_jyp"));
    const first = container.querySelector(".connections-grid .connections-tile");
    expect(first).not.toBeNull();
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(document.body);
    expect(container.querySelector(".game-actions-message")).toHaveTextContent(
      pt.connectionsSolved("Grupos da JYP Entertainment"),
    );
  });

  it("moves focus to the first tile after Clear, which disables itself", () => {
    const { container } = renderGame();
    fireEvent.click(tile(oneAway[0]!));
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(document.activeElement).toBe(container.querySelector(".connections-grid .connections-tile"));
  });

  it("ignores a second Submit inside the guard and a held Enter", () => {
    const { container } = renderGame();
    oneAway.forEach((id) => fireEvent.click(tile(id)));
    const submit = screen.getByRole("button", { name: "Enviar" });
    clock += SUBMIT_GUARD_MS + 1;
    fireEvent.click(submit);
    clock += SUBMIT_GUARD_MS - 1;
    fireEvent.click(submit);
    // Still the verdict of the first guess, and one mistake only.
    expect(container.querySelector(".game-actions-message")).toHaveTextContent(pt.connectionsOneAway);
    expect(screen.getByText("3 erros restantes")).toBeInTheDocument();

    const notPrevented = fireEvent.keyDown(submit, { key: "Enter", repeat: true });
    expect(notPrevented).toBe(false);

    // After the guard, the same four names count as already tried.
    clock += 2;
    fireEvent.click(submit);
    expect(container.querySelector(".game-actions-message")).toHaveTextContent(pt.connectionsAlreadyGuessed);
    expect(screen.getByText("3 erros restantes")).toBeInTheDocument();
  });

  it("puts the result in the bar and focuses its title when the game ends in this visit", () => {
    const { container } = renderGame();
    for (const category of puzzle.categories) guess(category.item_ids);

    const bar = container.querySelector(".game-actions")!;
    expect(bar).toHaveClass("is-correct");
    const title = within(bar as HTMLElement).getByRole("heading", { level: 2, name: pt.connectionsGameOverWon });
    expect(document.activeElement).toBe(title);
    expect(within(bar as HTMLElement).getByRole("button", { name: pt.connectionsShareButton })).toBeInTheDocument();
    expect(container.querySelector(".connections-controls")).toBeNull();
    // No dialog: the result is part of the page.
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("focuses the result title after a loss too", () => {
    const { container } = renderGame();
    const [a0, a1, a2] = categoryIds("cat_jyp");
    for (const other of categoryIds("cat_sm")) {
      if (container.querySelector(".connections-controls")) {
        fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
      }
      guess([a0!, a1!, a2!, other]);
    }
    const title = screen.getByRole("heading", { level: 2, name: pt.connectionsGameOverLost });
    expect(document.activeElement).toBe(title);
    expect(container.querySelector(".game-actions")).toHaveClass("is-incorrect");
    // The last "one away" does not stay on screen next to the result.
    expect(container.querySelector(".game-actions-message")).not.toHaveTextContent(pt.connectionsOneAway);
  });

  it("restores a finished game without moving focus", () => {
    localStorage.setItem(
      `kpop-connections-${puzzle.puzzle_id}`,
      JSON.stringify({
        solvedCategoryIds: puzzle.categories.map((c) => c.id),
        mistakesRemaining: 4,
        guessHistory: puzzle.categories.map((c) => c.item_ids),
        gameStatus: "won",
        boardItemIds: [],
      }),
    );
    renderGame();
    expect(screen.getByRole("heading", { level: 2, name: pt.connectionsGameOverWon })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("restores a game in progress without moving focus", () => {
    const rest = puzzle.items.map((i) => i.id).filter((id) => !categoryIds("cat_jyp").includes(id));
    localStorage.setItem(
      `kpop-connections-${puzzle.puzzle_id}`,
      JSON.stringify({
        solvedCategoryIds: ["cat_jyp"],
        mistakesRemaining: 3,
        guessHistory: [oneAway, categoryIds("cat_jyp")],
        gameStatus: "in_progress",
        boardItemIds: rest,
      }),
    );
    renderGame();
    expect(screen.getAllByRole("button", { name: /não selecionado/ })).toHaveLength(12);
    expect(document.activeElement).toBe(document.body);
  });

  it("guards the result buttons, and Play again focuses the new board", () => {
    const { container } = renderGame();
    for (const category of puzzle.categories) guess(category.item_ids);
    const again = screen.getByRole("button", { name: pt.connectionsRestart });

    fireEvent.click(again);
    expect(screen.getByRole("heading", { level: 2, name: pt.connectionsGameOverWon })).toBeInTheDocument();
    expect(fireEvent.keyDown(again, { key: "Enter", repeat: true })).toBe(false);

    clock += RESULT_GUARD_MS;
    fireEvent.click(again);
    expect(container.querySelectorAll(".connections-grid .connections-tile")).toHaveLength(16);
    expect(document.activeElement).toBe(container.querySelector(".connections-grid .connections-tile"));
  });

  it("shows each category's explanation and source behind Ver fonte", () => {
    renderGame();
    for (const category of puzzle.categories) guess(category.item_ids);
    const toggle = screen.getByRole("button", { name: pt.showSource });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(pt.hideSource);
    expect(panel).toBeVisible();
    for (const category of puzzle.categories) {
      expect(within(panel).getByRole("heading", { level: 3, name: category.label["pt-BR"] })).toBeInTheDocument();
      expect(within(panel).getByText(category.explanation["pt-BR"])).toBeInTheDocument();
      const link = within(panel).getAllByRole("link").find((a) => a.getAttribute("href") === category.evidence[0]!.source_url);
      expect(link).toBeDefined();
    }
  });

  it("does not count a restored game whose finish was already recorded", () => {
    markGameMatchRecorded("connections", `connections-${puzzle.puzzle_id}`);
    localStorage.setItem(
      `kpop-connections-${puzzle.puzzle_id}`,
      JSON.stringify({
        solvedCategoryIds: puzzle.categories.map((c) => c.id),
        mistakesRemaining: 4,
        guessHistory: puzzle.categories.map((c) => c.item_ids),
        gameStatus: "won",
        boardItemIds: [],
      }),
    );
    renderGame();
    expect(screen.getByRole("heading", { level: 2, name: pt.connectionsGameOverWon })).toBeInTheDocument();
    expect(loadPlayerStats().games.connections?.played ?? 0).toBe(0);
  });

  it("counts a game finished in this visit once", () => {
    renderGame();
    for (const category of puzzle.categories) guess(category.item_ids);
    expect(loadPlayerStats().games.connections?.played).toBe(1);
  });
});

describe("Connections share", () => {
  const original = {
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  };

  function setNavigator(key: "share" | "clipboard", value: unknown) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }

  // Wins, then presses Share past the result guard and lets the promises settle.
  async function winAndShare() {
    const view = renderGame();
    for (const category of puzzle.categories) guess(category.item_ids);
    clock += RESULT_GUARD_MS;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: pt.connectionsShareButton }));
    });
    return view;
  }

  function liveRegion(container: Element): HTMLElement {
    return container.querySelector<HTMLElement>(".game-actions-message[aria-live='polite']")!;
  }

  const shareText = () =>
    generateShareText({
      puzzle,
      guessHistory: puzzle.categories.map((c) => c.item_ids),
      mistakesRemaining: 4,
      locale: "pt-BR",
      monochrome: false,
    });

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
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
    const { container } = await winAndShare();

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
    // A new node in the live region, so screen readers read it again.
    const second = region.querySelector("p");
    expect(second).toHaveTextContent(pt.copiedToClipboard);
    expect(second).not.toBe(first);
  });

  it("shows the text to copy by hand and says so when the clipboard refuses", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const { container } = await winAndShare();

    expect(liveRegion(container)).toHaveTextContent(pt.shareFailed);
    const field = screen.getByRole("textbox", { name: pt.shareTextLabel });
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toBe(shareText());
    expect(field).toHaveAccessibleDescription(pt.shareFailed);
    expect(screen.getByRole("button", { name: pt.connectionsShareButton })).toBeInTheDocument();
  });

  it("shows the text to copy by hand when there is no clipboard", async () => {
    setNavigator("clipboard", undefined);
    const { container } = await winAndShare();
    expect(liveRegion(container)).toHaveTextContent(pt.shareFailed);
    expect(screen.getByRole("textbox", { name: pt.shareTextLabel })).toBeInTheDocument();
  });

  it("treats a closed share sheet as no error and does not copy", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    setNavigator("clipboard", { writeText });
    const { container } = await winAndShare();

    expect(share).toHaveBeenCalledWith({ text: shareText() });
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(liveRegion(container)).toBeEmptyDOMElement();
  });

  it("falls back to the clipboard when the share sheet fails", async () => {
    setNavigator("share", vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const { container } = await winAndShare();
    expect(writeText).toHaveBeenCalled();
    expect(liveRegion(container)).toHaveTextContent(pt.copiedToClipboard);
  });

  it("stops the Copied timer when the result goes away", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setNavigator("clipboard", { writeText: vi.fn().mockResolvedValue(undefined) });
      const { unmount } = await winAndShare();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
