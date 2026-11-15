import { describe, expect, it } from "vitest";
import { isLicensedMedia, isQuestion, isQuizSession } from "./quiz-types";
import { guardAfterChange, guardRows, withoutEachField, type GuardCase } from "../test/guard-table";
import ptSession from "../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";
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

const HASH_A = "a".repeat(64);
const isPtQuestion = (value: unknown) => isQuestion(value, "pt-BR");
const licensedMedia = () => ({
  asset_url: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Twice_photo.jpg",
  source_url: "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg",
  creator: "Dispatch",
  license_name: "CC BY 3.0",
  license_url: "https://creativecommons.org/licenses/by/3.0/",
  subject_qid: "Q21461452",
  verified_at: "2026-01-15",
  transformations: ["crop 4:5"],
});

// The fixture question plays in standard mode and offers one clue.
const QUESTION_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (q) => { q.extra = 1; }, false],
  ...withoutEachField([
    "id", "logical_id", "base_logical_id", "semantic_id", "fact_base_ids", "language", "type", "theme",
    "play_mode", "challenge_rating", "base_points", "hint_cost", "clues_available", "clues_shown",
    "group_ids", "prompt", "options", "answer_option_id", "explanation", "reference_date", "evidence",
  ]),
  ["media null", (q) => { q.media = null; }, true],
  ["licensed media", (q) => { q.media = licensedMedia(); }, true],
  ["media that is not licensed", (q) => { q.media = {}; }, false],
  ["every optional field at once", (q) => { q.media = null; q.decades = [2020]; q.group_relevance_score = 5; }, true],
  ["relevance score null", (q) => { q.group_relevance_score = null; }, true],
  ["relevance score 0", (q) => { q.group_relevance_score = 0; }, true],
  ["relevance score 10000", (q) => { q.group_relevance_score = 10_000; }, true],
  ["relevance score 10001", (q) => { q.group_relevance_score = 10_001; }, false],
  ["relevance score -1", (q) => { q.group_relevance_score = -1; }, false],
  ["fractional relevance score", (q) => { q.group_relevance_score = 2.5; }, false],
  ["relevance score as text", (q) => { q.group_relevance_score = "5"; }, false],
  ["no decade", (q) => { q.decades = []; }, true],
  ["ascending decades", (q) => { q.decades = [1990, 2020]; }, true],
  ["descending decades", (q) => { q.decades = [2020, 1990]; }, false],
  ["a repeated decade", (q) => { q.decades = [2020, 2020]; }, false],
  ["an unknown decade", (q) => { q.decades = [1980]; }, false],
  ["a decade as text", (q) => { q.decades = ["2020"]; }, false],
  ["decades that are not a list", (q) => { q.decades = 2020; }, false],
  ["a short id", (q) => { q.id = "abc"; }, false],
  ["an uppercase id", (q) => { q.id = "A".repeat(64); }, false],
  ["a numeric logical id", (q) => { q.logical_id = 1; }, false],
  ["an empty base logical id", (q) => { q.base_logical_id = ""; }, false],
  ["a semantic id one digit short", (q) => { q.semantic_id = "a".repeat(63); }, false],
  ["another language", (q) => { q.language = "en"; }, false],
  ["an unknown type", (q) => { q.type = "trivia"; }, false],
  ["an empty theme", (q) => { q.theme = ""; }, false],
  ["a blank theme", (q) => { q.theme = " "; }, true],
  ["an unknown play mode", (q) => { q.play_mode = "casual"; }, false],
  ["an unknown rating", (q) => { q.challenge_rating = "extreme"; }, false],
  ["base points 0", (q) => { q.base_points = 0; }, false],
  ["base points 1", (q) => { q.base_points = 1; }, true],
  ["fractional base points", (q) => { q.base_points = 1.5; }, false],
  ["base points as text", (q) => { q.base_points = "100"; }, false],
  ["hint cost -1", (q) => { q.hint_cost = -1; }, false],
  ["hint cost 0", (q) => { q.hint_cost = 0; }, true],
  ["fractional hint cost", (q) => { q.hint_cost = 0.5; }, false],
  ["an empty prompt", (q) => { q.prompt = ""; }, false],
  ["a blank prompt", (q) => { q.prompt = " "; }, true],
  ["an empty explanation", (q) => { q.explanation = ""; }, false],
  ["a numeric explanation", (q) => { q.explanation = 1; }, false],
  ["a reference date that does not exist", (q) => { q.reference_date = "2026-02-30"; }, false],
  ["a reference date before year 100", (q) => { q.reference_date = "0099-01-01"; }, false],
  ["a reference date without padding", (q) => { q.reference_date = "2026-9-13"; }, false],
  ["no fact", (q) => { q.fact_base_ids = []; }, false],
  ["an empty fact id", (q) => { q.fact_base_ids = [""]; }, false],
  ["a repeated fact id", (q) => { q.fact_base_ids = [q.fact_base_ids[0], q.fact_base_ids[0]]; }, false],
  ["a fact without evidence", (q) => { q.fact_base_ids.push("Q1$uncited"); }, false],
  ["no group", (q) => { q.group_ids = []; }, true],
  ["an empty group id", (q) => { q.group_ids = [""]; }, false],
  ["a repeated group id", (q) => { q.group_ids = ["Q1", "Q1"]; }, false],
  ["a numeric group id", (q) => { q.group_ids = [1]; }, false],
  ["no clue", (q) => { q.clues_available = []; }, true],
  ["clues that are not a list", (q) => { q.clues_available = {}; }, false],
  ["a clue with a short id", (q) => { q.clues_available[0].id = "abc"; }, false],
  ["a clue of another type", (q) => { q.clues_available[0].type = "year"; }, false],
  ["a clue with empty text", (q) => { q.clues_available[0].text = ""; }, false],
  ["a clue without facts", (q) => { q.clues_available[0].fact_base_ids = []; }, false],
  ["a clue with an extra key", (q) => { q.clues_available[0].extra = 1; }, false],
  ["a clue whose evidence has revision 0", (q) => { q.clues_available[0].evidence[0].revision_id = 0; }, false],
  ["a repeated clue", (q) => { q.clues_available.push(structuredClone(q.clues_available[0])); }, false],
  ["a clue shown in standard mode", (q) => { q.clues_shown = [q.clues_available[0].id]; }, false],
  ["a clue shown in assisted mode", (q) => { q.play_mode = "assisted"; q.clues_shown = [q.clues_available[0].id]; }, true],
  ["a clue shown twice in assisted mode", (q) => {
    q.play_mode = "assisted";
    q.clues_shown = [q.clues_available[0].id, q.clues_available[0].id];
  }, false],
  ["an unknown clue shown in assisted mode", (q) => { q.play_mode = "assisted"; q.clues_shown = [HASH_A]; }, false],
  ["clues offered in expert mode", (q) => { q.play_mode = "expert"; }, false],
  ["no clue in expert mode", (q) => { q.play_mode = "expert"; q.clues_available = []; }, true],
  ["three options", (q) => { q.options.pop(); }, false],
  ["five options", (q) => { q.options.push({ ...q.options[0], id: HASH_A, label: "x", value: "x" }); }, false],
  ["an option with an empty label", (q) => { q.options[1].label = ""; }, false],
  ["an option with an empty value", (q) => { q.options[1].value = ""; }, false],
  ["an option of an unknown type", (q) => { q.options.forEach((option: any) => { option.value_type = "date"; }); }, false],
  ["options of another shared type", (q) => { q.options.forEach((option: any) => { option.value_type = "number"; }); }, true],
  ["options of two types", (q) => { q.options[1].value_type = "number"; }, false],
  ["an option with a short id", (q) => { q.options[1].id = "abc"; }, false],
  ["an option with an extra key", (q) => { q.options[1].extra = 1; }, false],
  ["two options with one label", (q) => { q.options[1].label = q.options[0].label; }, false],
  ["two options with one value", (q) => { q.options[1].value = q.options[0].value; }, false],
  ["two options with one id", (q) => { q.options[1].id = q.options[2].id; }, false],
  ["another option as the answer", (q) => { q.answer_option_id = q.options[2].id; }, true],
  ["an answer outside the options", (q) => { q.answer_option_id = HASH_A; }, false],
  ["no evidence", (q) => { q.evidence = []; }, false],
  ["evidence that is not a list", (q) => { q.evidence = {}; }, false],
  ["evidence revision 0", (q) => { q.evidence[0].revision_id = 0; }, false],
  ["a fractional evidence revision", (q) => { q.evidence[0].revision_id = 1.5; }, false],
  ["an evidence revision as text", (q) => { q.evidence[0].revision_id = "1"; }, false],
  ["an empty locator", (q) => { q.evidence[0].locator = ""; }, false],
  ["an empty source key", (q) => { q.evidence[0].source_key = ""; }, false],
  ["an http source", (q) => { q.evidence[0].source_url = q.evidence[0].source_url.replace("https:", "http:"); }, false],
  ["evidence for another fact", (q) => { q.evidence[0].fact_base_id = "Q1$other"; }, false],
  ["evidence with an extra key", (q) => { q.evidence[0].extra = 1; }, false],
  ["evidence without its source key", (q) => { delete q.evidence[0].source_key; }, false],
  ["the same evidence twice", (q) => { q.evidence.push(structuredClone(q.evidence[0])); }, true],
];

describe("isQuestion fields", () => {
  it.each(guardRows(QUESTION_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(withClue(), change, isPtQuestion)).toBe(accepted);
  });

  it.each([null, [], "question", 1])("refuses %j", (value) => {
    expect(isQuestion(value, "pt-BR")).toBe(false);
  });

  it("refuses a question asked in another language than the round", () => {
    expect(isQuestion(withClue(), "en")).toBe(false);
  });
});

const sameForEveryQuestion = (session: any, change: (question: any) => void) => session.questions.forEach(change);

const SESSION_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["a catalog version", (s) => { s.catalog_version = HASH_A; }, true],
  ["a short catalog version", (s) => { s.catalog_version = "abc"; }, false],
  ["a numeric catalog version", (s) => { s.catalog_version = 1; }, false],
  ["an extra key", (s) => { s.extra = 1; }, false],
  ...withoutEachField(["schema_version", "dataset_version", "session_id", "config", "questions"]),
  ["a config that is a list", (s) => { s.config = []; }, false],
  ["a config with an extra key", (s) => { s.config.extra = 1; }, false],
  ["a config without seed", (s) => { delete s.config.seed; }, false],
  ["a config without timer", (s) => { delete s.config.timer_seconds; }, false],
  ["decade null", (s) => { s.config.decade = null; }, true],
  ["an unknown decade", (s) => { s.config.decade = 1980; }, false],
  ["a decade no question has", (s) => { s.config.decade = 2000; }, false],
  ["a decade every question has", (s) => {
    s.config.decade = 2020;
    sameForEveryQuestion(s, (q) => { q.decades = [2020]; });
  }, true],
  ["another schema", (s) => { s.schema_version = "kpop-quiz-session-v1"; }, false],
  ["a short dataset version", (s) => { s.dataset_version = "abc"; }, false],
  ["an uppercase session id", (s) => { s.session_id = "A".repeat(64); }, false],
  ["language en for Portuguese questions", (s) => { s.config.language = "en"; }, false],
  ["an unknown language", (s) => { s.config.language = "fr"; }, false],
  ["a numeric seed", (s) => { s.config.seed = 1; }, false],
  ["an empty seed", (s) => { s.config.seed = ""; }, true],
  ["an empty theme", (s) => { s.config.theme = ""; }, false],
  ["a theme some questions lack", (s) => { s.config.theme = "history"; }, false],
  ["a theme every question has", (s) => {
    s.config.theme = "history";
    sameForEveryQuestion(s, (q) => { q.theme = "history"; });
  }, true],
  ["an empty group", (s) => { s.config.group_id = ""; }, false],
  ["a group no question has", (s) => { s.config.group_id = "Q1"; }, false],
  ["a group every question has", (s) => {
    s.config.group_id = "Q1";
    sameForEveryQuestion(s, (q) => { q.group_ids = ["Q1"]; });
  }, true],
  ["a play mode the questions do not use", (s) => { s.config.play_mode = "expert"; }, false],
  ["an unknown play mode", (s) => { s.config.play_mode = "casual"; }, false],
  ["a 15 second timer", (s) => { s.config.timer_seconds = 15; }, true],
  ["a 0 second timer", (s) => { s.config.timer_seconds = 0; }, false],
  ["a fractional timer", (s) => { s.config.timer_seconds = 1.5; }, false],
  ["a timer as text", (s) => { s.config.timer_seconds = "15"; }, false],
  ["nine questions", (s) => { s.questions.pop(); }, false],
  ["eleven questions", (s) => { s.questions.push(structuredClone(s.questions[0])); }, false],
  ["a repeated question", (s) => { s.questions[1] = structuredClone(s.questions[0]); }, false],
  ["a repeated semantic id", (s) => { s.questions[1].semantic_id = s.questions[0].semantic_id; }, false],
  ["a question in another language", (s) => { s.questions[0].language = "en"; }, false],
  ["questions that are not a list", (s) => { s.questions = {}; }, false],
];

describe("isQuizSession fields", () => {
  it.each(guardRows(SESSION_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(ptSession, change, isQuizSession)).toBe(accepted);
  });

  it.each([null, [], "session"])("refuses %j", (value) => {
    expect(isQuizSession(value)).toBe(false);
  });
});

const MEDIA_CASES: GuardCase[] = [
  ["the fixture", () => {}, true],
  ["an extra key", (m) => { m.extra = 1; }, false],
  ...withoutEachField(["asset_url", "source_url", "creator", "license_name", "license_url", "subject_qid", "verified_at", "transformations"]),
  ["an http source", (m) => { m.source_url = "http://commons.wikimedia.org/wiki/File:Twice_photo.jpg"; }, false],
  ["an empty creator", (m) => { m.creator = ""; }, false],
  ["a blank creator", (m) => { m.creator = " "; }, false],
  ["a license outside the list", (m) => { m.license_name = "MIT"; }, false],
  ["Q0 as subject", (m) => { m.subject_qid = "Q0"; }, false],
  ["a check date that does not exist", (m) => { m.verified_at = "2026-02-30"; }, false],
  ["no transformation", (m) => { m.transformations = []; }, false],
  ["an empty transformation", (m) => { m.transformations = [""]; }, false],
  ["a repeated transformation", (m) => { m.transformations = ["crop", "crop"]; }, false],
];

describe("isLicensedMedia fields", () => {
  it.each(guardRows(MEDIA_CASES))("with $label: accepted is $accepted", ({ change, accepted }) => {
    expect(guardAfterChange(licensedMedia(), change, isLicensedMedia)).toBe(accepted);
  });
});
