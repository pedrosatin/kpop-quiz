import { describe, expect, it } from "vitest";
import { mapPilotEvents, mapPilotCountries, selectMapPilotRound } from "../../data/map-pilot";
import { DOT_RADIUS_PX, TARGET_RADIUS_PX, type FeatureShape } from "./map-pilot-geometry";
import {
  classes,
  featureMarks,
  pathClass,
  pathState,
  targetClass,
  targetState,
  type MapPickContext,
  type TargetContext,
} from "./map-pilot-targets";
import { deriveMapTurn, mapRoundOutcome } from "./map-pilot-turn";

const SINGAPORE: FeatureShape = { anchor: { x: 946, y: 295.5 }, width: 0.8, height: 0.2 };
const FRANCE: FeatureShape = { anchor: { x: 607, y: 112 }, width: 40, height: 30 };

const picking: MapPickContext = {
  selectedFeature: null,
  highlightFeature: null,
  answerFeature: "KOR",
  pickable: true,
  pointerSelects: true,
};

function target(shape: FeatureShape, id: string, ctx: Partial<TargetContext>) {
  return targetState(shape, id, { ...picking, finished: false, zoomed: false, scale: 0.25, ...ctx });
}

describe("map pilot marks", () => {
  it("joins only the class names that apply", () => {
    expect(classes("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("tells the pending pick, the wrong answer and the correct country apart", () => {
    expect(featureMarks("SGP", { ...picking, highlightFeature: "SGP" }))
      .toEqual({ isSelected: true, isCorrect: false, isWrong: false });
    const answered = { ...picking, selectedFeature: "SGP", highlightFeature: "SGP" };
    expect(featureMarks("SGP", answered)).toEqual({ isSelected: true, isCorrect: false, isWrong: true });
    expect(featureMarks("KOR", answered)).toEqual({ isSelected: false, isCorrect: true, isWrong: false });
    const right = { ...picking, selectedFeature: "KOR", highlightFeature: "KOR" };
    expect(featureMarks("KOR", right)).toEqual({ isSelected: true, isCorrect: true, isWrong: false });
  });

  it("keeps a country focusable but not picked by a tap while the first tap zooms", () => {
    const zoomFirst = pathState("FRA", true, { ...picking, pointerSelects: false });
    expect(zoomFirst).toMatchObject({ focusable: true, pointerPick: false });
    expect(pathClass(zoomFirst)).toBe("map-pilot-feature is-playable is-focusable");
    expect(pathClass(pathState("FRA", true, picking))).toBe("map-pilot-feature is-playable is-focusable is-pickable");
    expect(pathClass(pathState("RUS", false, picking))).toBe("map-pilot-feature");
    const answered = pathState("FRA", true, { ...picking, pickable: false, selectedFeature: "FRA", highlightFeature: "FRA" });
    expect(pathClass(answered)).toBe("map-pilot-feature is-playable is-selected is-wrong");
  });

  it("draws a dot on the whole map only for countries too small to see", () => {
    const dot = target(SINGAPORE, "SGP", {});
    expect(dot).toMatchObject({ marked: true, selects: true, radius: DOT_RADIUS_PX / 0.25 });
    expect(target(FRANCE, "FRA", {})).toMatchObject({ marked: false, selects: false });
    // Narrow whole map: the tap zooms, so the dot does not select.
    expect(target(SINGAPORE, "SGP", { pointerSelects: false }).selects).toBe(false);
  });

  it("gives every country a 44px target in the zoomed map, with a ring on the small ones", () => {
    const ring = target(SINGAPORE, "SGP", { zoomed: true, scale: 2 });
    expect(ring).toMatchObject({ marked: true, selects: true, radius: TARGET_RADIUS_PX / 2 });
    expect(targetClass(ring)).toBe("map-pilot-target is-marked is-pickable");
    const france = target(FRANCE, "FRA", { zoomed: true, scale: 2 });
    expect(france).toMatchObject({ marked: false, selects: true });
    expect(targetClass(france)).toBe("map-pilot-target is-pickable");
    expect(target(FRANCE, "FRA", { zoomed: true, scale: 2, pickable: false }).selects).toBe(false);
  });

  it("marks every target of the finished round as an answer", () => {
    const state = target(SINGAPORE, "SGP", { finished: true, pickable: false, answerFeature: null });
    expect(targetClass(state)).toBe("map-pilot-target is-marked is-answer");
  });
});

describe("map pilot turn", () => {
  const DATE = "2026-09-24";
  const round = selectMapPilotRound(mapPilotEvents, DATE);
  const countryByFeature = new Map(mapPilotCountries.map((country) => [country.map_feature_id, country]));
  const right = round.map((event) => event.map_feature_id);

  it("reads the pending pick until the answer is sent", () => {
    const turn = deriveMapTurn({ date: DATE, answers: [], index: 0 }, round, "SGP", countryByFeature);
    expect(turn).toMatchObject({ isComplete: false, selectedFeature: null, highlightFeature: "SGP", answerState: null, outcome: null });
    expect(turn.current).toBe(round[0]);
    expect(turn.answerCountry?.map_feature_id).toBe(right[0]);
    expect(deriveMapTurn({ date: DATE, answers: [], index: 0 }, round, "", countryByFeature).highlightFeature).toBeNull();
  });

  it("reads the committed answer and its verdict", () => {
    const wrong = right[0] === "SGP" ? "KOR" : "SGP";
    const turn = deriveMapTurn({ date: DATE, answers: [wrong], index: 0 }, round, "", countryByFeature);
    expect(turn).toMatchObject({ selectedFeature: wrong, highlightFeature: wrong, answerState: "incorrect" });
    expect(turn.selectedCountry?.map_feature_id).toBe(wrong);
    expect(deriveMapTurn({ date: DATE, answers: [right[0]!], index: 0 }, round, "", countryByFeature).answerState).toBe("correct");
  });

  it("ends the round with its outcome", () => {
    const turn = deriveMapTurn({ date: DATE, answers: right, index: round.length }, round, "", countryByFeature);
    expect(turn).toMatchObject({ isComplete: true, current: undefined, answerState: null, outcome: "win" });
    expect(mapRoundOutcome(round, right.map(() => "XXX"), false)).toBe("loss");
    expect(mapRoundOutcome(round, right, true)).toBe("give_up");
    expect(mapRoundOutcome(round, right.slice(1), false)).toBe("give_up");
  });
});
