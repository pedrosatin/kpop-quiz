import { describe, expect, it } from "vitest";
import { mapPilotEvents, selectMapPilotRound } from "../../data/map-pilot";
import { countRightAnswers, isRightAnswer, mapRoundOutcome } from "./map-pilot-turn";

const round = selectMapPilotRound(mapPilotEvents, "2026-09-24");
const right = round.map((event) => event.map_feature_id);
const wrong = (event: (typeof round)[number]) =>
  mapPilotEvents.find((candidate) => candidate.map_feature_id !== event.map_feature_id)!.map_feature_id;

describe("isRightAnswer", () => {
  it("accepts only the country of the date", () => {
    expect(isRightAnswer(round[0]!, right[0])).toBe(true);
    expect(isRightAnswer(round[0]!, wrong(round[0]!))).toBe(false);
    expect(isRightAnswer(round[0]!, undefined)).toBe(false);
  });
});

describe("countRightAnswers", () => {
  it("counts the right dates and takes a missing answer as wrong", () => {
    expect(countRightAnswers(round, right)).toBe(10);
    expect(countRightAnswers(round, right.slice(0, 3))).toBe(3);
    expect(countRightAnswers(round, round.map((event, i) => (i === 1 ? wrong(event) : event.map_feature_id)))).toBe(9);
    expect(countRightAnswers(round, [])).toBe(0);
  });
});

describe("mapRoundOutcome", () => {
  const halfRight = round.map((event, i) => (i < 5 ? wrong(event) : event.map_feature_id));
  const lessThanHalf = round.map((event, i) => (i < 6 ? wrong(event) : event.map_feature_id));

  it("wins with at least half the dates right and loses below that", () => {
    expect(mapRoundOutcome(round, right, false)).toBe("win");
    expect(mapRoundOutcome(round, halfRight, false)).toBe("win");
    expect(mapRoundOutcome(round, lessThanHalf, false)).toBe("loss");
  });

  it("counts a give-up or a round with unanswered dates as a give-up", () => {
    expect(mapRoundOutcome(round, right, true)).toBe("give_up");
    expect(mapRoundOutcome(round, right.slice(0, 9), false)).toBe("give_up");
  });
});
