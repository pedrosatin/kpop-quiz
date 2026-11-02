import { describe, expect, it } from "vitest";
import { isQuestion } from "./quiz-types";
import dailyPtSession from "../tests/fixtures/session.daily.pt-BR.standard.8c1ff312324883f8b724318e6bf7c132293eb9ee53ff8f8e0e5c2072562738f4.json";

const withClue = () => structuredClone(dailyPtSession.questions.find((q) => q.clues_available.length > 0)!) as any;

describe("isQuestion clues", () => {
  it("accepts a clue that cites another fact when its evidence covers it", () => {
    const question = withClue();
    const clue = question.clues_available[0];
    clue.fact_base_ids = ["Q9$answer-date"];
    clue.evidence = [{ ...clue.evidence[0], fact_base_id: "Q9$answer-date" }];
    expect(question.fact_base_ids).not.toContain("Q9$answer-date");
    expect(isQuestion(question, "pt-BR")).toBe(true);
  });

  it("rejects a clue fact without evidence", () => {
    const question = withClue();
    question.clues_available[0].fact_base_ids = [...question.clues_available[0].fact_base_ids, "Q9$answer-date"];
    expect(isQuestion(question, "pt-BR")).toBe(false);
  });

  it("rejects a clue with no evidence at all", () => {
    const question = withClue();
    question.clues_available[0].evidence = [];
    expect(isQuestion(question, "pt-BR")).toBe(false);
  });
});
