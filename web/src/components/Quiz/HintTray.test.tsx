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
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("Esta pergunta não tem pista disponível.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      cleanup();
      renderTray("assisted", "en");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("This question has no clue available.");
    });

    it("says in Standard that nothing is charged and offers no button", () => {
      renderTray("standard");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("Nenhum ponto será descontado.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(/-15/)).not.toBeInTheDocument();
      cleanup();
      renderTray("standard", "en");
      expect(screen.getByTestId("quiz-no-clue")).toHaveTextContent("No points will be deducted.");
    });

    it("stays silent in Expert, which has no clues by design", () => {
      const { container } = renderTray("expert");
      expect(container.firstChild).toBeNull();
    });

    it("drops the notice once the question is answered", () => {
      const { container } = renderTray("standard", "pt-BR", true);
      expect(container.firstChild).toBeNull();
    });
  });

  it("does not show the notice when a clue exists", () => {
    render(
      <HintTray
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
