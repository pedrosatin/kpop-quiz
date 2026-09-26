import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import validPuzzleJson from "../../tests/fixtures/name-guess.daily.json";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { NameGuessGame } from "./NameGuessGame";
import { RESULT_GUARD_MS, generateShareText } from "./NameGuessResults";
import { getMessages } from "../../i18n/catalog";

const puzzle = validPuzzleJson as unknown as NameGuessPuzzle;
const tPt = getMessages("pt-BR").nameGuess;

// The result buttons ignore activation for RESULT_GUARD_MS after they replace
// the keyboard. Tests that click them step this clock past the window first.
let now = 1_000;
function advanceClock(ms = RESULT_GUARD_MS) {
  now += ms;
}

function typeGuess(word: string) {
  for (const char of word) {
    fireEvent.click(screen.getByRole("button", { name: char }));
  }
  fireEvent.click(screen.getByRole("button", { name: tPt.enter }));
}

function liveMessage(): HTMLElement {
  const live = screen.getByRole("region", { name: tPt.title }).querySelector<HTMLElement>(".game-actions .game-actions-message");
  if (!live) throw new Error("action bar live region missing");
  return live;
}

describe("NameGuessGame component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders header, attempts remaining, board, and virtual keyboard", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    // The page intro owns the visible title; the game region keeps it as its name.
    expect(screen.getByRole("region", { name: tPt.title })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: tPt.title })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${tPt.attemptsLeft}: 6/6`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.highContrast })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.enter })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.backspace })).toBeInTheDocument();
  });

  it("puts the keyboard in the card's action bar, with ENTER and DEL enabled", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const keyboard = screen.getByRole("group", { name: tPt.keyboardAria });
    expect(keyboard.closest(".game-actions")).not.toBeNull();
    expect(keyboard.closest(".game-hud")).toBeNull();
    for (const name of [tPt.enter, tPt.backspace, "Q", "P", "M"]) {
      expect(within(keyboard).getByRole("button", { name })).toBeEnabled();
    }

    fireEvent.click(within(keyboard).getByRole("button", { name: "Q" }));
    expect(screen.getByLabelText("Posição 1: letra Q")).toBeInTheDocument();
  });

  it("keeps the high-contrast toggle out of the HUD and the game card", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const game = screen.getByRole("region", { name: tPt.title });
    const toggle = screen.getByRole("button", { name: tPt.highContrast });
    expect(game.contains(toggle)).toBe(false);
    expect(game.querySelector(".game-hud button")).toBeNull();
    // A plain button stays in the tab order.
    expect(toggle.tabIndex).toBe(0);
    expect(toggle).not.toBeDisabled();
  });

  it("restores the high-contrast preference from storage after a reload", () => {
    const first = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    fireEvent.click(screen.getByRole("button", { name: tPt.highContrast }));
    first.unmount();

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByRole("button", { name: tPt.highContrast })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: tPt.title })).toHaveAttribute("data-contrast", "high");
  });

  it("labels the high-contrast toggle in the locale and switches a single attribute on the card", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const game = screen.getByRole("region", { name: tPt.title });
    const toggle = screen.getByRole("button", { name: tPt.highContrast });
    expect(toggle).toHaveTextContent(/^Cores de alto contraste$/);
    expect(game).toHaveAttribute("data-contrast", "normal");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveTextContent(/^Cores de alto contraste$/);
    expect(game).toHaveAttribute("data-contrast", "high");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(game.querySelectorAll("[data-contrast], .high-contrast")).toHaveLength(0);
  });

  it("handles virtual keyboard clicks and backspace", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Palpite 1" });

    fireEvent.click(screen.getByRole("button", { name: "T" }));
    fireEvent.click(screen.getByRole("button", { name: "W" }));
    expect(within(row1).getByLabelText("Posição 1: letra T")).toBeInTheDocument();
    expect(within(row1).getByLabelText("Posição 2: letra W")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tPt.backspace }));
    expect(within(row1).getByLabelText("Posição 2: vazia")).toBeInTheDocument();
  });

  it("handles physical keyboard inputs", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Palpite 1" });

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "e" });
    expect(within(row1).getByLabelText("Posição 1: letra A")).toBeInTheDocument();
    expect(within(row1).getByLabelText("Posição 2: letra E")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(within(row1).getByLabelText("Posição 2: vazia")).toBeInTheDocument();
  });

  it("announces a short guess in the action bar live region mounted before the first guess", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const live = liveMessage();
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "T" }));
    fireEvent.click(screen.getByRole("button", { name: tPt.enter }));

    // Same node: a region created with its text is often not announced.
    expect(liveMessage()).toBe(live);
    expect(live).toHaveTextContent(tPt.notEnoughLetters);
    expect(live.closest(".name-guess-board")).toBeNull();
    // The buttons stay out of the announcement.
    expect(within(live).queryByRole("button")).toBeNull();
  });

  it("keeps the long invalid-name error available to assistive technology", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("Z".repeat(puzzle.word_length));

    expect(liveMessage()).toHaveTextContent(tPt.notInWordList);
  });

  it("clears the error from the live region once the player types again", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("T");
    expect(liveMessage()).toHaveTextContent(tPt.notEnoughLetters);

    fireEvent.click(screen.getByRole("button", { name: "W" }));
    expect(liveMessage()).toBeEmptyDOMElement();
  });

  it("plays winning game and displays results card with clues and copy", async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardSpy },
    });

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("TWICE");

    // Game is won
    expect(screen.getByText(tPt.wonTitle)).toBeInTheDocument();

    // The description, the stats and the source open from the result bar.
    const details = screen.getByRole("button", { name: tPt.showSource });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(details).toHaveAccessibleName(tPt.hideSource);
    const hints = document.getElementById(details.getAttribute("aria-controls")!);
    expect(hints).toBeVisible();
    expect(within(hints!).getAllByText(/JYP Entertainment/).length).toBeGreaterThanOrEqual(1);
    expect(within(hints!).getAllByText(/2015/).length).toBeGreaterThanOrEqual(1);
    expect(within(hints!).getByRole("link", { name: tPt.evidenceLink })).toHaveAttribute(
      "href",
      puzzle.target.evidence[0]!.source_url,
    );

    // Click copy results
    advanceClock();
    const copyBtn = screen.getByRole("button", { name: tPt.copyResults });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(clipboardSpy).toHaveBeenCalled();
    });

    // Reset game
    advanceClock();
    const playAgainBtn = screen.getByRole("button", { name: tPt.playAgain });
    fireEvent.click(playAgainBtn);
    expect(screen.queryByText(tPt.wonTitle)).not.toBeInTheDocument();
  });

  it("shows the source link when the target has no clues", () => {
    const { clues: _clues, ...target } = puzzle.target;
    render(<NameGuessGame locale="pt-BR" puzzle={{ ...puzzle, target }} />);

    typeGuess("TWICE");

    const toggle = screen.getByRole("button", { name: tPt.showSource });
    fireEvent.click(toggle);
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toBeVisible();
    expect(within(panel).getByRole("link", { name: tPt.evidenceLink })).toHaveAttribute(
      "href",
      puzzle.target.evidence[0]!.source_url,
    );
    expect(within(panel).queryByText(tPt.debutYear)).not.toBeInTheDocument();
  });

  it("hides the toggle when the target has neither clues nor a source", () => {
    const { clues: _clues, ...target } = puzzle.target;
    render(<NameGuessGame locale="pt-BR" puzzle={{ ...puzzle, target: { ...target, evidence: [] } }} />);

    typeGuess("TWICE");

    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tPt.showSource })).not.toBeInTheDocument();
  });

  it("shows the error over the HUD, outside the action bar, and announces it from the bar", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("T");

    const live = liveMessage();
    expect(live).toHaveClass("visually-hidden");
    expect(live).toHaveTextContent(tPt.notEnoughLetters);
    const toast = screen.getByRole("region", { name: tPt.title }).querySelector(".name-guess-toast");
    expect(toast).toHaveTextContent(tPt.notEnoughLetters);
    expect(toast).toHaveAttribute("aria-hidden", "true");
    expect(toast!.closest(".game-actions")).toBeNull();
    expect(toast!.closest(".name-guess-play")).not.toBeNull();
  });

  it("moves focus to the empty board after Play again", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("TWICE");
    advanceClock();
    fireEvent.click(screen.getByRole("button", { name: tPt.playAgain }));

    const board = screen.getByRole("region", { name: tPt.boardAria });
    expect(document.activeElement).toBe(board);
    expect(board).toHaveAttribute("tabindex", "-1");
    expect(within(board).getAllByLabelText("Posição 1: vazia").length).toBe(puzzle.max_attempts);

    // Typing works right away from the focused board.
    fireEvent.keyDown(board, { key: "a" });
    expect(within(screen.getByRole("group", { name: "Palpite 1" })).getByLabelText("Posição 1: letra A")).toBeInTheDocument();
  });

  it("does not submit or restart on a physical Enter while the result title or Share has focus", () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboardSpy } });
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("TWICE");
    advanceClock();
    const title = screen.getByRole("heading", { name: tPt.wonTitle });
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();
    expect(screen.getByText(`${tPt.attemptsLeft}: 5/6`)).toBeInTheDocument();

    const share = screen.getByRole("button", { name: tPt.copyResults });
    share.focus();
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(share, { key: "Enter" });

    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();
    expect(screen.getByText(`${tPt.attemptsLeft}: 5/6`)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: tPt.keyboardAria })).not.toBeInTheDocument();
  });

  it("replaces the keyboard with the result and focuses the result title", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("TWICE");

    const title = screen.getByRole("heading", { name: tPt.wonTitle });
    expect(document.activeElement).toBe(title);
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("group", { name: tPt.keyboardAria })).not.toBeInTheDocument();

    const result = screen.getByRole("region", { name: tPt.wonTitle });
    expect(result.closest(".game-actions")).not.toBeNull();
    expect(result.closest(".game-actions")).toHaveClass("is-correct");
    expect(within(result).getByRole("button", { name: tPt.copyResults })).toBeInTheDocument();
    // The final board stays on the card, above the bar.
    expect(within(screen.getByRole("group", { name: "Palpite 1" })).getByLabelText("Posição 1: letra T, posição certa")).toBeInTheDocument();
  });

  it("focuses the result title after the sixth wrong guess", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    for (const guess of ["AESPA", "ALICE", "ALPHA", "APRIL", "BRAVE", "DREAM"]) {
      typeGuess(guess);
    }

    const title = screen.getByRole("heading", { name: tPt.lostTitle });
    expect(document.activeElement).toBe(title);
    expect(title.closest(".game-actions")).toHaveClass("is-incorrect");
  });

  it("keeps the guesses counter in the HUD after the game ends", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("AESPA");
    expect(screen.getByText(`${tPt.attemptsLeft}: 5/6`)).toBeInTheDocument();

    typeGuess("TWICE");
    expect(screen.getByText(`${tPt.attemptsLeft}: 4/6`)).toBeInTheDocument();
  });

  it("does not move focus when a finished game is restored from storage", () => {
    const first = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    typeGuess("TWICE");
    first.unmount();
    document.body.focus();

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("ignores a tap on the result buttons right after they replace the keyboard", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    typeGuess("TWICE");
    const playAgain = screen.getByRole("button", { name: tPt.playAgain });

    fireEvent.click(playAgain);
    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();

    // A held Enter repeats keydown; its default action is canceled.
    expect(fireEvent.keyDown(playAgain, { key: "Enter", repeat: true })).toBe(false);

    advanceClock();
    fireEvent.click(playAgain);
    expect(screen.queryByRole("heading", { name: tPt.wonTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: tPt.keyboardAria })).toBeInTheDocument();
  });

  it("renders localized aria labels when locale is en", () => {
    const tEn = getMessages("en").nameGuess;
    render(<NameGuessGame locale="en" puzzle={puzzle} />);

    expect(screen.getByRole("region", { name: tEn.boardAria })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: tEn.keyboardAria })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: tEn.rowAria(1) })).toBeInTheDocument();
  });

  it("ignores physical keydown events when target is a form input", () => {
    render(
      <div>
        <input type="text" data-testid="form-input" />
        <NameGuessGame locale="pt-BR" puzzle={puzzle} />
      </div>
    );

    const input = screen.getByTestId("form-input");
    const row1 = screen.getByRole("group", { name: "Palpite 1" });

    fireEvent.keyDown(input, { key: "a" });
    expect(within(row1).queryByLabelText("Posição 1: letra A")).not.toBeInTheDocument();
  });

  it("submits a complete row when Enter arrives before the last letter re-renders", async () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    // Plain dispatches skip act(), so no render or effect runs between the keys,
    // like a fast typist pressing the last letter and Enter in the same frame.
    for (const key of ["t", "w", "i", "c", "e", "Enter"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }

    await waitFor(() => {
      expect(screen.getByText(tPt.wonTitle)).toBeInTheDocument();
    });
    expect(screen.queryByText(tPt.notEnoughLetters)).not.toBeInTheDocument();
  });

  it("lets Enter on a focused button do only the button's action", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Palpite 1" });
    for (const key of ["t", "w", "i", "c"]) {
      fireEvent.keyDown(window, { key });
    }

    // The browser turns Enter on a focused button into a click on that button.
    const keyE = screen.getByRole("button", { name: "E" });
    keyE.focus();
    fireEvent.keyDown(keyE, { key: "Enter" });
    fireEvent.click(keyE);

    expect(within(row1).getByLabelText("Posição 5: letra E")).toBeInTheDocument();
    expect(liveMessage()).toBeEmptyDOMElement();
    expect(screen.queryByText(tPt.wonTitle)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: tPt.highContrast });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(tPt.wonTitle)).not.toBeInTheDocument();
  });

  it("still types letters from the physical keyboard while a virtual key has focus", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Palpite 1" });
    const keyT = screen.getByRole("button", { name: "T" });
    fireEvent.click(keyT);
    keyT.focus();

    fireEvent.keyDown(keyT, { key: "w" });
    fireEvent.keyDown(keyT, { key: "Backspace" });
    fireEvent.keyDown(keyT, { key: "i" });

    expect(within(row1).getByLabelText("Posição 1: letra T")).toBeInTheDocument();
    expect(within(row1).getByLabelText("Posição 2: letra I")).toBeInTheDocument();
  });

  it("submits with a physical Enter after a click on a virtual key", async () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    // Browsers focus a clicked button unless its mousedown is canceled.
    const keyT = screen.getByRole("button", { name: "T" });
    if (fireEvent.mouseDown(keyT)) keyT.focus();
    fireEvent.click(keyT);

    for (const key of ["w", "i", "c", "e", "Enter"]) {
      fireEvent.keyDown(document.activeElement ?? window, { key });
    }

    await waitFor(() => {
      expect(screen.getByText(tPt.wonTitle)).toBeInTheDocument();
    });
  });

  it("ignores key events already handled elsewhere or pressed with a modifier", () => {
    const claimLetterA = (e: KeyboardEvent) => {
      if (e.key === "a") e.preventDefault();
    };
    document.addEventListener("keydown", claimLetterA);
    try {
      render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
      const row1 = screen.getByRole("group", { name: "Palpite 1" });

      fireEvent.keyDown(document.body, { key: "a" });
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", metaKey: true });
      fireEvent.keyDown(window, { key: "d", altKey: true });

      expect(within(row1).getByLabelText("Posição 1: vazia")).toBeInTheDocument();
    } finally {
      document.removeEventListener("keydown", claimLetterA);
    }
  });

  it("loads puzzle asynchronously via fetch when initial puzzle is omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => puzzle,
      })
    );

    render(<NameGuessGame locale="pt-BR" baseUrl="http://localhost:3000" />);

    expect(screen.getByText(tPt.loading)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: tPt.title })).toBeInTheDocument();
    });
  });

  it("shows error and retry button when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
    );

    render(<NameGuessGame locale="pt-BR" baseUrl="http://localhost:3000" />);

    await waitFor(() => {
      expect(screen.getByText(tPt.artifactMissing)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: tPt.retry })).toBeInTheDocument();
    });
  });
});

describe("NameGuess share", () => {
  const original = {
    share: Object.getOwnPropertyDescriptor(navigator, "share"),
    clipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  };

  function setNavigator(key: "share" | "clipboard", value: unknown) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }

  // Wins in one guess, then presses Share past the result guard and lets the
  // promises settle.
  async function winAndShare() {
    const view = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    typeGuess("TWICE");
    advanceClock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tPt.copyResults }));
    });
    return view;
  }

  const shareText = () =>
    generateShareText({
      puzzle,
      feedbacks: [Array.from({ length: puzzle.word_length }, () => "correct" as const)],
      won: true,
      attempts: 1,
      highContrast: false,
    });

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    setNavigator("share", undefined);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    for (const key of ["share", "clipboard"] as const) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
  });

  it("opens the share sheet with the result and does not copy", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    setNavigator("clipboard", { writeText });
    const { container } = await winAndShare();

    expect(share).toHaveBeenCalledWith({ text: shareText() });
    expect(shareText()).toContain("1/6");
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(liveMessage()).toBeEmptyDOMElement();
  });

  it("treats a closed share sheet as no error and does not copy", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("share", share);
    setNavigator("clipboard", { writeText });
    const { container } = await winAndShare();

    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(liveMessage()).toBeEmptyDOMElement();
  });

  it("falls back to the clipboard when the share sheet fails", async () => {
    setNavigator("share", vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await winAndShare();

    expect(writeText).toHaveBeenCalledWith(shareText());
    expect(liveMessage()).toHaveTextContent(tPt.copied);
  });

  it("copies the result and announces it again on a second copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    const { container } = await winAndShare();

    expect(writeText).toHaveBeenCalledWith(shareText());
    const region = liveMessage();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(tPt.copied);
    expect(screen.getByRole("button", { name: tPt.copied })).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();

    const first = region.querySelector("p");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: tPt.copied }));
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    // A new node in the live region, so screen readers read it again.
    const second = region.querySelector("p");
    expect(second).toHaveTextContent(tPt.copied);
    expect(second).not.toBe(first);
  });

  it("shows the text to copy by hand and says so when the clipboard refuses", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await winAndShare();

    expect(liveMessage()).toHaveTextContent(tPt.shareFailed);
    const field = screen.getByRole("textbox", { name: tPt.shareTextLabel });
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toBe(shareText());
    expect(field).toHaveAccessibleDescription(tPt.shareFailed);
    expect(document.querySelector(".name-guess-share-fallback p")).toHaveTextContent(tPt.shareFailed);
    expect(screen.getByRole("button", { name: tPt.copyResults })).toBeInTheDocument();

    // Focus or a click selects the whole text.
    const textarea = field as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
    textarea.setSelectionRange(0, 0);
    fireEvent.click(textarea);
    expect(textarea.selectionEnd).toBe(textarea.value.length);

    // Typing in the field does not reach the game.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(screen.getByRole("heading", { name: tPt.wonTitle })).toBeInTheDocument();
  });

  it("shows the text to copy by hand when there is no clipboard", async () => {
    setNavigator("clipboard", undefined);
    await winAndShare();

    expect(liveMessage()).toHaveTextContent(tPt.shareFailed);
    expect(screen.getByRole("textbox", { name: tPt.shareTextLabel })).toBeInTheDocument();
  });

  it("clears the share announcement after Play again", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockResolvedValue(undefined) });
    await winAndShare();
    expect(liveMessage()).toHaveTextContent(tPt.copied);

    advanceClock();
    fireEvent.click(screen.getByRole("button", { name: tPt.playAgain }));
    expect(liveMessage()).toBeEmptyDOMElement();
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
