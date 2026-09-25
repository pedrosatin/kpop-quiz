import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { ScoreSummary } from "./ScoreSummary";
import { getMessages } from "../../i18n/catalog";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");

describe("ScoreSummary", () => {
  it("renders hits over total, score, formatted elapsed time, and clues revealed in PT-BR", () => {
    render(
      <ScoreSummary
        correctCount={8}
        totalQuestions={10}
        score={850}
        elapsedSeconds={222}
        cluesUsedCount={1}
        messages={ptMessages}
      />
    );

    expect(screen.getByText("8/10")).toBeInTheDocument();
    expect(screen.getByText("Acertos")).toBeInTheDocument();
    expect(screen.getByText("850")).toBeInTheDocument();
    expect(screen.getByText("Pontos")).toBeInTheDocument();
    expect(screen.getByText("03:42")).toBeInTheDocument();
    expect(screen.getByText("Tempo total")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Pistas usadas")).toBeInTheDocument();
    expect(screen.getByText("Você fez 850 pontos.")).toBeInTheDocument();
  });

  it("renders correctly in English", () => {
    render(
      <ScoreSummary
        correctCount={10}
        totalQuestions={10}
        score={1000}
        elapsedSeconds={95}
        cluesUsedCount={0}
        messages={enMessages}
      />
    );

    expect(screen.getByText("10/10")).toBeInTheDocument();
    expect(screen.getByText("Correct answers")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("01:35")).toBeInTheDocument();
    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Clues used")).toBeInTheDocument();
    expect(screen.getByText("You scored 1000 points.")).toBeInTheDocument();
  });
});
