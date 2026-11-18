import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { AnswerFeedback } from "./AnswerFeedback";
import { QuizResult } from "./QuizResult";
import { quizBarState, quizFeedbackKind } from "./answer-feedback-message";
import { getMessages } from "../../i18n/catalog";
import type { QuizOption } from "../../lib/quiz-types";

const messages = getMessages("pt-BR");
const twice: QuizOption = { id: "opt-1", label: "TWICE", value: "TWICE", value_type: "group" };
const itzy: QuizOption = { id: "opt-2", label: "ITZY", value: "ITZY", value_type: "group" };

describe("quizFeedbackKind / quizBarState", () => {
  it("exposes correct and incorrect kinds only after an answer", () => {
    expect(quizFeedbackKind(false, true)).toBeNull();
    expect(quizFeedbackKind(true, true)).toBe("correct");
    expect(quizFeedbackKind(true, false)).toBe("incorrect");
    expect(quizBarState(true, true)).toBe(" is-correct");
    expect(quizBarState(true, false)).toBe(" is-incorrect");
  });
});

describe("AnswerFeedback feel", () => {
  it("marks a correct answer with data-feedback, class and decorative mark", () => {
    const { container } = render(
      <AnswerFeedback
        answered={true}
        canSubmit={true}
        isCorrect={true}
        timedOut={false}
        selectedOption={twice}
        correctOption={twice}
        explanation="ok"
        evidence={[]}
        messages={messages}
        isLastQuestion={false}
        onSubmit={vi.fn()}
        onAdvance={vi.fn()}
      />,
    );
    const bar = container.querySelector(".game-actions")!;
    expect(bar).toHaveClass("is-correct");
    expect(bar).toHaveAttribute("data-feedback", "correct");
    expect(screen.getByRole("status")).toHaveTextContent("Você acertou.");
    expect(container.querySelector(".feedback-mark")).toHaveTextContent("✓");
    expect(container.querySelector(".feedback-mark")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks an incorrect answer with data-feedback, class and decorative mark", () => {
    const { container } = render(
      <AnswerFeedback
        answered={true}
        canSubmit={true}
        isCorrect={false}
        timedOut={false}
        selectedOption={itzy}
        correctOption={twice}
        explanation="ok"
        evidence={[]}
        messages={messages}
        isLastQuestion={false}
        onSubmit={vi.fn()}
        onAdvance={vi.fn()}
      />,
    );
    const bar = container.querySelector(".game-actions")!;
    expect(bar).toHaveClass("is-incorrect");
    expect(bar).toHaveAttribute("data-feedback", "incorrect");
    expect(screen.getByRole("status")).toHaveTextContent("Não foi dessa vez.");
    expect(container.querySelector(".feedback-mark")).toHaveTextContent("✗");
  });
});

describe("QuizResult feel", () => {
  it("tags the result title with data-feedback=result and no won/lost class", () => {
    const { rerender, container } = render(
      <QuizResult
        score={100}
        messages={messages}
        locale="pt-BR"
        onRestart={vi.fn()}
        totalQuestions={10}
        correctCount={10}
        feedbackEligible={false}
      />,
    );
    const title = container.querySelector("#result-heading")!;
    expect(title).toHaveAttribute("data-feedback", "result");
    expect(title).toHaveClass("result-title");
    expect(title).not.toHaveClass("is-won");
    expect(title).not.toHaveClass("is-lost");

    rerender(
      <QuizResult
        score={0}
        messages={messages}
        locale="pt-BR"
        onRestart={vi.fn()}
        totalQuestions={10}
        correctCount={0}
        feedbackEligible={false}
      />,
    );
    const lost = container.querySelector("#result-heading")!;
    expect(lost).toHaveAttribute("data-feedback", "result");
    expect(lost).not.toHaveClass("is-won");
    expect(lost).not.toHaveClass("is-lost");
  });
});
