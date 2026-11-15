import type { TimelineEvent, TimelinePuzzle } from "../../lib/quiz-types";
import type { TimelineGameStatus, TimelineStoredState } from "./types";
import { getInitialTimelineEventIds, isEventOrderOf } from "./timeline-utils";

// Rules of a timeline match, kept apart from the hook that holds its state.

export interface TimelineGameStart {
  orderedEventIds: string[];
  gameStatus: TimelineGameStatus;
  gaveUp: boolean;
  score: number;
  results: boolean[];
}

/**
 * Where a match starts: the submitted save, else the order of the draft, else
 * the puzzle's shuffled opening order.
 */
export function startingTimelineGame(
  puzzle: TimelinePuzzle,
  saved: TimelineStoredState | null,
  draft: string[] | null,
): TimelineGameStart {
  if (saved) {
    return {
      orderedEventIds: saved.orderedEventIds,
      gameStatus: saved.submitted ? "submitted" : "in_progress",
      gaveUp: saved.gaveUp === true,
      score: saved.score,
      results: saved.results,
    };
  }
  return {
    orderedEventIds: draft ?? getInitialTimelineEventIds(puzzle),
    gameStatus: "in_progress",
    gaveUp: false,
    score: 0,
    results: [],
  };
}

/** Whether the card at `index` can move up during the match. */
export function canMoveUpAt(status: TimelineGameStatus, index: number, length: number): boolean {
  return status === "in_progress" && index > 0 && index < length;
}

/** Whether the card at `index` can move down during the match. */
export function canMoveDownAt(status: TimelineGameStatus, index: number, length: number): boolean {
  return status === "in_progress" && index >= 0 && index < length - 1;
}

/** Whether `next` is an order of the puzzle's events that the match takes as a move. */
export function isNewTimelineOrder(
  status: TimelineGameStatus,
  next: string[],
  current: readonly string[],
  puzzle: TimelinePuzzle,
): boolean {
  if (status !== "in_progress" || !isEventOrderOf(next, puzzle)) return false;
  return !next.every((id, index) => id === current[index]);
}

/** The puzzle's events by id. */
export function indexTimelineEvents(events: readonly TimelineEvent[]): Map<string, TimelineEvent> {
  const map = new Map<string, TimelineEvent>();
  for (const event of events) {
    map.set(event.id, event);
  }
  return map;
}

/** The events of `ids` in that order, without the ids the puzzle does not have. */
export function eventsInOrder(ids: readonly string[], eventMap: Map<string, TimelineEvent>): TimelineEvent[] {
  return ids
    .map((id) => eventMap.get(id))
    .filter((event): event is TimelineEvent => Boolean(event));
}

/** The save written on submit, with the fields in the order the stored JSON has always had. */
export function submittedTimelineState(
  puzzle: TimelinePuzzle,
  orderedEventIds: string[],
  evaluation: { score: number; results: boolean[] },
  gaveUp: boolean,
): TimelineStoredState {
  return {
    puzzleId: puzzle.puzzle_id,
    referenceDate: puzzle.reference_date,
    orderedEventIds,
    submitted: true,
    gaveUp,
    score: evaluation.score,
    results: evaluation.results,
  };
}
