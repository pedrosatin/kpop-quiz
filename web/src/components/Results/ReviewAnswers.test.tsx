import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { ReviewAnswers } from "./ReviewAnswers";
import { getMessages } from "../../i18n/catalog";
import type { QuestionResult } from "../Quiz/types";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");

const sampleItems: QuestionResult[] = [
  {
    question: {
      id: "q-1",
      prompt: "Qual grupo lançou Cheer Up?",
      options: [
        { id: "opt-1", label: "TWICE", value: "TWICE", value_type: "group" },
        { id: "opt-2", label: "Red Velvet", value: "Red Velvet", value_type: "group" },
      ],
      answer_option_id: "opt-1",
      explanation: "Cheer Up foi lançado pelo TWICE em 2016.",
      clues_available: [],
      clues_shown: [],
      evidence: [
        {
          fact_base_id: "fb-1",
          locator: "P31",
          revision_id: 123,
          source_key: "domain:wikidata.org",
          source_url: "https://www.wikidata.org/wiki/Q1",
        },
      ],
      play_mode: "standard",
      base_points: 100,
      hint_cost: 15,
      challenge_rating: "medium",
      logical_id: "log-1",
      base_logical_id: "blog-1",
      semantic_id: "sem-1",
      fact_base_ids: ["fb-1"],
      language: "pt-BR",
      type: "release_for_group",
      theme: "history",
      group_ids: ["g-1"],
      reference_date: "2026-01-01",
    },
    selectedOptionId: "opt-1",
    isCorrect: true,
    cluesUsedCount: 0,
  },
  {
    question: {
      id: "q-2",
      prompt: "Qual grupo estreou em 2014?",
      options: [
        { id: "opt-3", label: "Red Velvet", value: "Red Velvet", value_type: "group" },
        { id: "opt-4", label: "BLACKPINK", value: "BLACKPINK", value_type: "group" },
      ],
      answer_option_id: "opt-3",
      explanation: "Red Velvet estreou em agosto de 2014.",
      clues_available: [],
      clues_shown: [],
      evidence: [
        {
          fact_base_id: "fb-2",
          locator: "lead",
          revision_id: 456,
          source_key: "wikipedia:pt",
          source_url: "https://pt.wikipedia.org/wiki/Red_Velvet",
        },
      ],
      play_mode: "standard",
      base_points: 100,
      hint_cost: 15,
      challenge_rating: "medium",
      logical_id: "log-2",
      base_logical_id: "blog-2",
      semantic_id: "sem-2",
      fact_base_ids: ["fb-2"],
      language: "pt-BR",
      type: "formation_year",
      theme: "history",
      group_ids: ["g-1"],
      reference_date: "2026-01-01",
    },
    selectedOptionId: "opt-4",
    isCorrect: false,
    cluesUsedCount: 1,
  },
  {
    question: {
      id: "q-3",
      prompt: "Qual integrante nasceu em 1997?",
      options: [
        { id: "opt-5", label: "Jihyo", value: "Jihyo", value_type: "person" },
        { id: "opt-6", label: "Mina", value: "Mina", value_type: "person" },
      ],
      answer_option_id: "opt-5",
      explanation: "Jihyo nasceu em 1 de fevereiro de 1997.",
      clues_available: [],
      clues_shown: [],
      evidence: [],
      play_mode: "standard",
      base_points: 100,
      hint_cost: 15,
      challenge_rating: "medium",
      logical_id: "log-3",
      base_logical_id: "blog-3",
      semantic_id: "sem-3",
      fact_base_ids: ["fb-3"],
      language: "pt-BR",
      type: "birth_date_or_place",
      theme: "history",
      group_ids: ["g-1"],
      reference_date: "2026-01-01",
    },
    selectedOptionId: null,
    isCorrect: false,
    cluesUsedCount: 0,
  },
];

describe("ReviewAnswers", () => {
  it("renders null when there are no items", () => {
    const { container } = render(<ReviewAnswers items={[]} messages={ptMessages} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays the questions list, selected answers, correct answers, explanations and evidence in PT-BR", () => {
    render(<ReviewAnswers items={sampleItems} messages={ptMessages} />);

    expect(screen.getByRole("heading", { level: 3, name: "Revisão das respostas" })).toBeInTheDocument();

    // Question 1: Correct
    expect(screen.getByText("Qual grupo lançou Cheer Up?")).toBeInTheDocument();
    expect(screen.getByText("Pergunta 1 de 3")).toBeInTheDocument();
    expect(screen.getByText("Acertou.")).toBeInTheDocument();
    expect(screen.getByText("Cheer Up foi lançado pelo TWICE em 2016.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir revisão no Wikidata" })).toHaveAttribute(
      "href",
      "https://www.wikidata.org/wiki/Q1"
    );

    // Question 2: Incorrect
    expect(screen.getByText("Qual grupo estreou em 2014?")).toBeInTheDocument();
    expect(screen.getByText("Pergunta 2 de 3")).toBeInTheDocument();
    expect(screen.getAllByText("Não foi dessa vez.")).toHaveLength(2);
    expect(screen.getByText("Red Velvet estreou em agosto de 2014.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir revisão no Wikipedia" })).toHaveAttribute(
      "href",
      "https://pt.wikipedia.org/wiki/Red_Velvet"
    );

    // Question 3: Timed out / No answer
    expect(screen.getByText("Qual integrante nasceu em 1997?")).toBeInTheDocument();
    expect(screen.getByText("Pergunta 3 de 3")).toBeInTheDocument();
    expect(screen.getByText("Sem resposta")).toBeInTheDocument();
    expect(screen.getByText("Jihyo")).toBeInTheDocument();

    // Verify it is purely informative (no buttons modifying answers or points)
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders properly with English labels", () => {
    render(<ReviewAnswers items={sampleItems.slice(0, 1)} messages={enMessages} />);

    expect(screen.getByRole("heading", { level: 3, name: "Review answers" })).toBeInTheDocument();
    expect(screen.getByText("Question 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Correct.")).toBeInTheDocument();
    expect(screen.getByText("Your answer:")).toBeInTheDocument();
    expect(screen.getByText("Correct answer:")).toBeInTheDocument();
  });
});
