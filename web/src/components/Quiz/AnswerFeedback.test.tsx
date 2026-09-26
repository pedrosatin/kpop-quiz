import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { AnswerFeedback, type AnswerFeedbackProps } from "./AnswerFeedback";
import { getMessages } from "../../i18n/catalog";
import type { QuizOption } from "../../lib/quiz-types";

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

const twice: QuizOption = { id: "opt-1", label: "TWICE", value: "TWICE", value_type: "group" };
const itzy: QuizOption = { id: "opt-2", label: "ITZY", value: "ITZY", value_type: "group" };

function renderBar(props: Partial<AnswerFeedbackProps> = {}) {
  return render(
    <AnswerFeedback
      answered={true}
      canSubmit={true}
      isCorrect={true}
      timedOut={false}
      selectedOption={twice}
      correctOption={twice}
      explanation="TWICE estreou em 2015."
      evidence={sampleEvidence}
      messages={messages}
      isLastQuestion={false}
      onSubmit={vi.fn()}
      onAdvance={vi.fn()}
      {...props}
    />
  );
}

describe("AnswerFeedback", () => {
  it("shows the hint and Submit before an answer", () => {
    renderBar({ answered: false, canSubmit: false });
    expect(screen.getByRole("status")).toHaveTextContent(messages.chooseAnswer);
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Ver fonte" })).not.toBeInTheDocument();
  });

  it("keeps the explanation and source behind a toggle next to Next", () => {
    const onAdvance = vi.fn();
    renderBar({ onAdvance });
    expect(screen.getByRole("status")).toHaveTextContent("Você acertou.");
    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("TWICE estreou em 2015.")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(region).toBeVisible();
    expect(region).toHaveTextContent("TWICE estreou em 2015.");
    expect(screen.getByRole("link", { name: "Abrir a revisão no Wikidata" })).toHaveAttribute("href", sampleEvidence[0]!.source_url);
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("labels the player's answer next to the correct one after a miss", () => {
    renderBar({ isCorrect: false, selectedOption: itzy });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Não foi dessa vez.");
    expect(status).toHaveTextContent("Sua resposta: ITZY · Resposta correta: TWICE");
  });

  it("keeps the live region to the message", () => {
    renderBar({ isCorrect: false, selectedOption: itzy });
    const status = screen.getByRole("status");
    expect(status).toHaveClass("game-actions-message");
    expect(status.querySelector("button, a")).toBeNull();
    expect(status.closest(".game-actions")).toContainElement(screen.getByRole("button", { name: "Próxima pergunta" }));
  });

  it("ignores the second click of a double click on Next", () => {
    const onAdvance = vi.fn();
    renderBar({ onAdvance });
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }), { detail: 2 });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("shows the correct answer without a player answer on timeout", () => {
    renderBar({ isCorrect: false, timedOut: true, isLastQuestion: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Acabou o tempo.");
    expect(status).toHaveTextContent("Resposta correta: TWICE");
    expect(status).not.toHaveTextContent("Sua resposta");
    expect(screen.getByRole("button", { name: "Ver resultado" })).toBeInTheDocument();
  });

  it("reports a timeout even if isCorrect is passed as true", () => {
    renderBar({ isCorrect: true, timedOut: true });
    expect(screen.getByRole("status")).toHaveTextContent("Acabou o tempo.");
    expect(screen.queryByText("Você acertou.")).not.toBeInTheDocument();
  });
});
