import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { AnswerFeedback } from "./AnswerFeedback";
import { getMessages } from "../../i18n/catalog";

const messages = getMessages("pt-BR");

const sampleEvidence = [
  {
    fact_base_id: "fb-1",
    locator: "P31",
    revision_id: 100,
    source_key: "domain:wikidata.org",
    source_url: "https://www.wikidata.org/wiki/Q1",
  },
];

describe("AnswerFeedback", () => {
  it("displays success status and explanation on correct answer", () => {
    const onAdvance = vi.fn();
    render(
      <AnswerFeedback
        isCorrect={true}
        timedOut={false}
        correctOption={{ id: "opt-1", label: "TWICE", value: "TWICE", value_type: "group" }}
        explanation="TWICE estreou em 2015."
        evidence={sampleEvidence}
        messages={messages}
        isLastQuestion={false}
        onAdvance={onAdvance}
      />
    );
    expect(screen.getByText("Acertou.")).toBeInTheDocument();
    expect(screen.getByText("TWICE estreou em 2015.")).toBeInTheDocument();
    const nextBtn = screen.getByRole("button", { name: "Próxima pergunta" });
    fireEvent.click(nextBtn);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("displays timeout feedback and shows correct answer", () => {
    render(
      <AnswerFeedback
        isCorrect={false}
        timedOut={true}
        correctOption={{ id: "opt-1", label: "TWICE", value: "TWICE", value_type: "group" }}
        explanation="O tempo expirou."
        evidence={sampleEvidence}
        messages={messages}
        isLastQuestion={true}
        onAdvance={vi.fn()}
      />
    );
    expect(screen.getByText("O tempo acabou.")).toBeInTheDocument();
    expect(screen.getByText("Resposta correta:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver resultado" })).toBeInTheDocument();
  });
});
