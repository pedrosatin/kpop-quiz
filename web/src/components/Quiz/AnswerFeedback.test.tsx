import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerFeedback, NEXT_GUARD_MS, type AnswerFeedbackProps } from "./AnswerFeedback";
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

// Next ignores activation for NEXT_GUARD_MS after it appears; the tests move
// this clock instead of waiting.
let now = 1_000;
function advanceClock(ms = NEXT_GUARD_MS) {
  now += ms;
}

// jsdom has no default action for Enter; a browser clicks the button unless
// a keydown handler cancels it.
function pressEnter(target: HTMLElement, repeat = false) {
  if (fireEvent.keyDown(target, { key: "Enter", code: "Enter", repeat })) fireEvent.click(target);
}

/** Holds the answered state like QuizRound, so Submit swaps to Next. */
function StatefulBar({ onAdvance }: { onAdvance: () => void }) {
  const [answered, setAnswered] = useState(false);
  return (
    <AnswerFeedback
      answered={answered}
      canSubmit={true}
      isCorrect={true}
      timedOut={false}
      selectedOption={twice}
      correctOption={twice}
      explanation="TWICE estreou em 2015."
      evidence={sampleEvidence}
      messages={messages}
      isLastQuestion={false}
      onSubmit={() => setAnswered(true)}
      onAdvance={onAdvance}
    />
  );
}

describe("AnswerFeedback", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a hint that differs from the options legend, and Submit, before an answer", () => {
    renderBar({ answered: false, canSubmit: false });
    expect(screen.getByRole("status")).toHaveTextContent("Escolha uma alternativa e confirme em Responder.");
    expect(messages.submitHint).not.toBe(messages.chooseAnswer);
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
    expect(toggle).toHaveTextContent("Ocultar fonte");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(region).toBeVisible();
    expect(region).toHaveTextContent("TWICE estreou em 2015.");
    expect(screen.getByRole("link", { name: "Abrir a revisão no Wikidata" })).toHaveAttribute("href", sampleEvidence[0]!.source_url);
    advanceClock();
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Ver fonte");
  });

  it("labels the toggle in English", () => {
    renderBar({ messages: getMessages("en") });
    const toggle = screen.getByRole("button", { name: "Show source" });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Hide source");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("puts the source links right after the open toggle in tab order", () => {
    renderBar();
    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    fireEvent.click(toggle);
    const focusable = [...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    expect(focusable[focusable.indexOf(toggle) + 1]).toBe(screen.getByRole("link", { name: "Abrir a revisão no Wikidata" }));
  });

  it("repeats both answers in the sources panel, since the bar clamps them", () => {
    renderBar({ isCorrect: false, selectedOption: itzy });
    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toHaveTextContent("Sua resposta: ITZY · Resposta correta: TWICE");
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

  it("keeps the toggle, the panel and Next in DOM order in a wrapper with no role", () => {
    renderBar({ isCorrect: false, selectedOption: itzy });
    // From 60rem the wrapper uses display: contents, which drops a role in
    // some browsers; it must stay a plain div.
    const next = screen.getByRole("button", { name: "Próxima pergunta" });
    const wrapper = next.parentElement!;
    expect(wrapper).toHaveClass("quiz-actions-buttons");
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper).not.toHaveAttribute("role");
    const toggle = screen.getByRole("button", { name: "Ver fonte" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect([...wrapper.children]).toEqual([toggle, panel, next]);
  });

  it("advances on a single click once the guard window has passed", () => {
    const onAdvance = vi.fn();
    renderBar({ onAdvance });
    advanceClock();
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }), { detail: 1 });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("does not skip the verdict when a double click on Submit lands on Next", () => {
    const onAdvance = vi.fn();
    render(<StatefulBar onAdvance={onAdvance} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder" }), { detail: 1 });
    advanceClock(120);
    fireEvent.click(screen.getByRole("button", { name: "Próxima pergunta" }), { detail: 2 });
    expect(onAdvance).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Você acertou.");
  });

  it("ignores a repeated Enter from a held key on Next", () => {
    const onAdvance = vi.fn();
    renderBar({ onAdvance });
    advanceClock();
    pressEnter(screen.getByRole("button", { name: "Próxima pergunta" }), true);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("advances on a fresh Enter on Next after the guard window", () => {
    const onAdvance = vi.fn();
    renderBar({ onAdvance });
    advanceClock();
    pressEnter(screen.getByRole("button", { name: "Próxima pergunta" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
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
