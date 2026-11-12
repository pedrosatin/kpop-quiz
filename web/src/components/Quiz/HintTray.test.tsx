import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { HintTray } from "./HintTray";
import { getMessages } from "../../i18n/catalog";
import type { QuizClue } from "../../lib/quiz-types";

const messages = getMessages("pt-BR");

const sampleClue: QuizClue = {
  id: "clue-1",
  type: "decade",
  text: "Estreou nos anos 2010",
  fact_base_ids: ["fact-1"],
  evidence: [],
};

describe("HintTray", () => {
  it("displays already revealed clues with status role", () => {
    render(
      <HintTray
        questionId="q-1"
        playMode="assisted"
        cluesAvailable={[sampleClue]}
        cluesShown={["clue-1"]}
        revealedClues={[]}
        hintCost={15}
        answered={false}
        onRevealClue={vi.fn()}
        messages={messages}
      />
    );
    const clueItem = screen.getByRole("status");
    expect(clueItem).toHaveTextContent(sampleClue.text);
  });

  it("reveals clue in standard mode on click", () => {
    const onReveal = vi.fn();
    render(
      <HintTray
        questionId="q-1"
        playMode="standard"
        cluesAvailable={[sampleClue]}
        cluesShown={[]}
        revealedClues={[]}
        hintCost={15}
        answered={false}
        onRevealClue={onReveal}
        messages={messages}
      />
    );
    const button = screen.getByRole("button", { name: "Ver pista (-15 pontos)" });
    fireEvent.click(button);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("omits reveal button and returns null in expert mode when no clues are active", () => {
    const { container } = render(
      <HintTray
        questionId="q-1"
        playMode="expert"
        cluesAvailable={[sampleClue]}
        cluesShown={[]}
        revealedClues={[]}
        hintCost={15}
        answered={false}
        onRevealClue={vi.fn()}
        messages={messages}
      />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  describe("when the question has no clue", () => {
    const renderTray = (playMode: "assisted" | "standard" | "expert", locale: "pt-BR" | "en" = "pt-BR", answered = false) =>
      render(
        <HintTray
          questionId="q-1"
          playMode={playMode}
          cluesAvailable={[]}
          cluesShown={[]}
          revealedClues={[]}
          hintCost={15}
          answered={answered}
          onRevealClue={vi.fn()}
          messages={getMessages(locale)}
        />
      );

    it("says so in Assisted, in both languages, without a button", () => {
      renderTray("assisted");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("Sem pista nesta pergunta.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      cleanup();
      renderTray("assisted", "en");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("No clue for this question.");
    });

    it("says so in Standard without a button or a cost", () => {
      renderTray("standard");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("Sem pista nesta pergunta.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(/-15/)).not.toBeInTheDocument();
      cleanup();
      renderTray("standard", "en");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("No clue for this question.");
    });

    it("stays silent in Expert, which has no clues by design", () => {
      const { container } = renderTray("expert");
      expect(container.firstChild).toBeNull();
    });

    it("keeps the same line after the answer, so the options below it do not move", () => {
      const { rerender } = renderTray("standard");
      const before = screen.getByTestId("quiz-no-clue");
      rerender(
        <HintTray
          questionId="q-1"
          playMode="standard"
          cluesAvailable={[]}
          cluesShown={[]}
          revealedClues={[]}
          hintCost={15}
          answered={true}
          onRevealClue={vi.fn()}
          messages={messages}
        />
      );
      expect(screen.getByTestId("quiz-no-clue")).toBe(before);
      expect(before).toHaveTextContent("Sem pista nesta pergunta.");
    });

    // A live region announces what is added to it. With the same text on two
    // questions in a row and nothing replaced, the second would stay silent.
    it("replaces the text inside the same live region on the next question without a clue", () => {
      const { rerender } = renderTray("standard");
      const region = screen.getByTestId("quiz-no-clue");
      const firstText = region.firstElementChild;
      rerender(
        <HintTray
          questionId="q-2"
          playMode="standard"
          cluesAvailable={[]}
          cluesShown={[]}
          revealedClues={[]}
          hintCost={15}
          answered={false}
          onRevealClue={vi.fn()}
          messages={messages}
        />
      );
      expect(screen.getByTestId("quiz-no-clue")).toBe(region);
      expect(region).toHaveAttribute("role", "status");
      expect(region.firstElementChild).not.toBe(firstText);
      expect(firstText?.isConnected).toBe(false);
      expect(region).toHaveTextContent("Sem pista nesta pergunta.");
    });
  });

  it("does not show the notice when a clue exists", () => {
    render(
      <HintTray
        questionId="q-1"
        playMode="standard"
        cluesAvailable={[sampleClue]}
        cluesShown={[]}
        revealedClues={[]}
        hintCost={15}
        answered={false}
        onRevealClue={vi.fn()}
        messages={messages}
      />
    );
    expect(screen.queryByTestId("quiz-no-clue")).not.toBeInTheDocument();
  });
});
