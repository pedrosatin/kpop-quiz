import { describe, expect, it } from "vitest";
import type { TimelinePuzzle } from "../../lib/quiz-types";
import fixture from "../../tests/fixtures/timeline.daily.json";
import {
  canMoveDownAt,
  canMoveUpAt,
  eventsInOrder,
  indexTimelineEvents,
  isNewTimelineOrder,
  startingTimelineGame,
  submittedTimelineState,
} from "./timeline-game-state";
import { getInitialTimelineEventIds } from "./timeline-utils";

const puzzle = fixture as unknown as TimelinePuzzle;
const ids = puzzle.events.map((event) => event.id);

describe("startingTimelineGame", () => {
  it("starts from the submitted save", () => {
    const saved = { puzzleId: puzzle.puzzle_id, referenceDate: puzzle.reference_date, orderedEventIds: ids, submitted: true, gaveUp: true, score: 5, results: [true, true, true, true, true] };
    expect(startingTimelineGame(puzzle, saved, ["ignored"])).toStrictEqual({
      orderedEventIds: ids,
      gameStatus: "submitted",
      gaveUp: true,
      score: 5,
      results: saved.results,
    });
  });

  it("starts from the draft, else from the shuffled opening order", () => {
    const draft = [...ids].reverse();
    expect(startingTimelineGame(puzzle, null, draft)).toStrictEqual({ orderedEventIds: draft, gameStatus: "in_progress", gaveUp: false, score: 0, results: [] });
    expect(startingTimelineGame(puzzle, null, null).orderedEventIds).toEqual(getInitialTimelineEventIds(puzzle));
  });
});

describe("canMoveUpAt and canMoveDownAt", () => {
  it("allow a move inside the board while the match is on", () => {
    expect(canMoveUpAt("in_progress", 1, 3)).toBe(true);
    expect(canMoveUpAt("in_progress", 0, 3)).toBe(false);
    expect(canMoveUpAt("in_progress", 3, 3)).toBe(false);
    expect(canMoveUpAt("submitted", 1, 3)).toBe(false);
    expect(canMoveDownAt("in_progress", 1, 3)).toBe(true);
    expect(canMoveDownAt("in_progress", 2, 3)).toBe(false);
    expect(canMoveDownAt("in_progress", -1, 3)).toBe(false);
    expect(canMoveDownAt("submitted", 1, 3)).toBe(false);
  });
});

describe("isNewTimelineOrder", () => {
  it("takes a different order of the puzzle's events while the match is on", () => {
    const next = [ids[1]!, ids[0]!, ...ids.slice(2)];
    expect(isNewTimelineOrder("in_progress", next, ids, puzzle)).toBe(true);
    expect(isNewTimelineOrder("in_progress", ids, ids, puzzle)).toBe(false);
    expect(isNewTimelineOrder("submitted", next, ids, puzzle)).toBe(false);
    expect(isNewTimelineOrder("in_progress", ids.slice(1), ids, puzzle)).toBe(false);
  });
});

describe("indexTimelineEvents and eventsInOrder", () => {
  it("list the events of the ids in order and skip unknown ids", () => {
    const map = indexTimelineEvents(puzzle.events);
    expect(eventsInOrder([ids[2]!, "unknown", ids[0]!], map)).toEqual([puzzle.events[2], puzzle.events[0]]);
  });
});

describe("submittedTimelineState", () => {
  it("writes the save fields in their stored order", () => {
    const state = submittedTimelineState(puzzle, ids, { score: 2, results: [true, false] }, false);
    expect(JSON.stringify(state)).toBe(JSON.stringify({
      puzzleId: puzzle.puzzle_id,
      referenceDate: puzzle.reference_date,
      orderedEventIds: ids,
      submitted: true,
      gaveUp: false,
      score: 2,
      results: [true, false],
    }));
  });
});
