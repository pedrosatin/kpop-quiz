import { describe, expect, it } from "vitest";
import { isLicensedMedia, isQuestion } from "./quiz-types";
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

describe("isLicensedMedia", () => {
  const media = () => ({
    asset_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Twice_photo.jpg/960px-Twice_photo.jpg",
    source_url: "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg",
    creator: "Dispatch",
    license_name: "CC BY 3.0",
    license_url: "https://creativecommons.org/licenses/by/3.0/",
    subject_qid: "Q21461452",
    verified_at: "2026-01-15",
    transformations: ["crop 4:5"],
  });

  it("accepts media whose URLs are all https", () => {
    expect(isLicensedMedia(media())).toBe(true);
  });

  it.each(["asset_url", "license_url"] as const)("rejects an http %s", (field) => {
    const value = media();
    value[field] = value[field].replace("https://", "http://");
    expect(isLicensedMedia(value)).toBe(false);
  });
});
