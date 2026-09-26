import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import validPuzzleJson from "../../tests/fixtures/name-guess.daily.json";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { NameGuessGame } from "./NameGuessGame";
import { RESULT_GUARD_MS } from "./NameGuessResults";
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

    // The clues open from the result bar.
    const details = screen.getByRole("button", { name: tPt.hints });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    const hints = document.getElementById(details.getAttribute("aria-controls")!);
    expect(hints).toBeVisible();
    expect(within(hints!).getAllByText(/JYP Entertainment/).length).toBeGreaterThanOrEqual(1);
    expect(within(hints!).getAllByText(/2015/).length).toBeGreaterThanOrEqual(1);

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
