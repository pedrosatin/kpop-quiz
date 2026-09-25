import { fireEvent, render, screen } from "@testing-library/preact";
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
});
