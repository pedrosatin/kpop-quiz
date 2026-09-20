import { cleanup, render, fireEvent } from "@testing-library/preact";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../tests/fixtures/name-guess.daily.json";
import type { NameGuessPuzzle } from "../../lib/quiz-types";
import { NameGuessGame } from "./NameGuessGame";
import { NameGuessResults } from "./NameGuessResults";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { NAME_GUESS_I18N, type LetterStatus } from "./types";

const puzzle = validPuzzleJson as unknown as NameGuessPuzzle;
const tPt = NAME_GUESS_I18N["pt-BR"];

describe("Automated accessibility audits with axe-core for NameGuess", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("validates NameGuessGame in initial state with zero violations", async () => {
    const { container } = render(<NameGuessGame locale="pt-BR" puzzle={puzzle} />);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates NameGuessGame with inputs entered and high contrast toggled with zero violations", async () => {
    const { container, getByRole } = render(
      <NameGuessGame locale="pt-BR" puzzle={puzzle} />
    );

    const highContrastBtn = getByRole("button", { name: /Alto contraste/i });
    fireEvent.click(highContrastBtn);

    fireEvent.click(getByRole("button", { name: "A" }));
    fireEvent.click(getByRole("button", { name: "E" }));
    fireEvent.click(getByRole("button", { name: "S" }));
    fireEvent.click(getByRole("button", { name: "P" }));
    fireEvent.click(getByRole("button", { name: "A" }));

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates NameGuessGame after guess submission with zero violations", async () => {
    const { container, getByRole } = render(
      <NameGuessGame locale="pt-BR" puzzle={puzzle} />
    );

    fireEvent.click(getByRole("button", { name: "A" }));
    fireEvent.click(getByRole("button", { name: "E" }));
    fireEvent.click(getByRole("button", { name: "S" }));
    fireEvent.click(getByRole("button", { name: "P" }));
    fireEvent.click(getByRole("button", { name: "A" }));
    fireEvent.click(getByRole("button", { name: tPt.enter }));

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates NameGuessResults in won state with zero violations", async () => {
    const wonFeedbacks: LetterStatus[][] = [
      ["correct", "correct", "correct", "correct", "correct"],
    ];

    const { container } = render(
      <NameGuessResults
        puzzle={puzzle}
        guesses={["TWICE"]}
        feedbacks={wonFeedbacks}
        status="won"
        locale="pt-BR"
        highContrast={false}
        t={tPt}
        onReset={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates NameGuessResults in lost state with zero violations", async () => {
    const lostFeedbacks: LetterStatus[][] = Array.from({ length: 6 }, () => [
      "absent",
      "present",
      "absent",
      "absent",
      "absent",
    ]);

    const { container } = render(
      <NameGuessResults
        puzzle={puzzle}
        guesses={Array(6).fill("AESPA")}
        feedbacks={lostFeedbacks}
        status="lost"
        locale="pt-BR"
        highContrast={true}
        t={tPt}
        onReset={vi.fn()}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("validates VirtualKeyboard with diverse key statuses with zero violations", async () => {
    const { container } = render(
      <VirtualKeyboard
        keyStatuses={{ T: "correct", W: "present", X: "absent" }}
        onChar={vi.fn()}
        onEnter={vi.fn()}
        onBackspace={vi.fn()}
        highContrast={false}
        t={tPt}
        disabled={false}
      />
    );
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
