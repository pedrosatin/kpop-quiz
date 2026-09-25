import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import validPuzzleJson from "../../tests/fixtures/name-guess.daily.json";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { NameGuessGame } from "./NameGuessGame";
import { NAME_GUESS_I18N } from "./types";

const puzzle = validPuzzleJson as unknown as NameGuessPuzzle;
const tPt = NAME_GUESS_I18N["pt-BR"];

describe("NameGuessGame component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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
    expect(screen.getByRole("button", { name: /Alto contraste: OFF/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.enter })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tPt.backspace })).toBeInTheDocument();
  });

  it("switches high contrast with a single attribute on the game card", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const game = screen.getByRole("region", { name: tPt.title });
    const toggle = screen.getByRole("button", { name: new RegExp(tPt.highContrast, "i") });
    expect(game).toHaveAttribute("data-contrast", "normal");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(game).toHaveAttribute("data-contrast", "high");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(game.querySelectorAll("[data-contrast], .high-contrast")).toHaveLength(0);
  });

  it("handles virtual keyboard clicks and backspace", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Tentativa 1" });

    fireEvent.click(screen.getByRole("button", { name: "T" }));
    fireEvent.click(screen.getByRole("button", { name: "W" }));
    expect(within(row1).getByLabelText("Posição 1: letra T")).toBeInTheDocument();
    expect(within(row1).getByLabelText("Posição 2: letra W")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tPt.backspace }));
    expect(within(row1).getByLabelText("Posição 2: vazio")).toBeInTheDocument();
  });

  it("handles physical keyboard inputs", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    const row1 = screen.getByRole("group", { name: "Tentativa 1" });

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "e" });
    expect(within(row1).getByLabelText("Posição 1: letra A")).toBeInTheDocument();
    expect(within(row1).getByLabelText("Posição 2: letra E")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(within(row1).getByLabelText("Posição 2: vazio")).toBeInTheDocument();
  });

  it("shows error alert on short guess", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    expect(document.querySelector(".name-guess-error-region")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "T" }));
    fireEvent.click(screen.getByRole("button", { name: tPt.enter }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(tPt.notEnoughLetters);
    expect(alert.closest(".name-guess-error-region")).not.toBeNull();
  });

  it("keeps the long invalid-name error available to assistive technology", () => {
    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    for (let i = 0; i < puzzle.word_length; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Z" }));
    }
    fireEvent.click(screen.getByRole("button", { name: tPt.enter }));

    expect(screen.getByRole("alert")).toHaveTextContent(tPt.notInWordList);
  });

  it("plays winning game and displays results card with clues and copy", async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardSpy },
    });

    render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);

    // Type TWICE
    ["T", "W", "I", "C", "E"].forEach((char) => {
      fireEvent.click(screen.getByRole("button", { name: char }));
    });
    fireEvent.click(screen.getByRole("button", { name: tPt.enter }));

    // Game is won
    expect(screen.getByText(tPt.wonTitle)).toBeInTheDocument();
    expect(screen.getAllByText(/JYP Entertainment/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2015/).length).toBeGreaterThanOrEqual(1);

    // Click copy results
    const copyBtn = screen.getByRole("button", { name: tPt.copyResults });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(clipboardSpy).toHaveBeenCalled();
    });

    // Reset game
    const playAgainBtn = screen.getByRole("button", { name: tPt.playAgain });
    fireEvent.click(playAgainBtn);
    expect(screen.queryByText(tPt.wonTitle)).not.toBeInTheDocument();
  });

  it("renders localized aria labels when locale is en", () => {
    const tEn = NAME_GUESS_I18N["en"];
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
    const row1 = screen.getByRole("group", { name: "Tentativa 1" });

    fireEvent.keyDown(input, { key: "a" });
    expect(within(row1).queryByLabelText("Posição 1: letra A")).not.toBeInTheDocument();
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
