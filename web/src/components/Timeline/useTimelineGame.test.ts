import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import type { TimelinePuzzle, TimelineEvent } from "../../lib/timeline-types";
import validTimeline from "../../tests/fixtures/timeline.daily.json";
import { useTimelineGame } from "./useTimelineGame";
import {
  calculateScore,
  generateTimelineShareText,
  getCanonicalChronologicalOrder,
  loadTimelineSavedState,
} from "./timeline-utils";

const puzzle = validTimeline as unknown as TimelinePuzzle;
const reversedPuzzle: TimelinePuzzle = {
  ...puzzle,
  events: [...puzzle.events].reverse(),
};

describe("useTimelineGame and timeline utils", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with puzzle events order and canonical order", () => {
    const { result } = renderHook(() => useTimelineGame(reversedPuzzle, "pt-BR"));
    expect(result.current.gameStatus).toBe("in_progress");
    expect(result.current.orderedEventIds).toEqual(reversedPuzzle.events.map((e) => e.id));
    expect(result.current.score).toBe(0);
    expect(result.current.results).toEqual([]);
    expect(result.current.shareText).toBe("");
    expect(result.current.canonicalOrder.map((e) => e.date)).toEqual([
      "1997", "1999", "2011", "2017", "2021",
    ]);
  });

  it("calculates score directly for zero matches, partial matches, and exact matches", () => {
    const canonical = getCanonicalChronologicalOrder(puzzle.events);

    // Exact matches
    const exact = calculateScore(canonical, canonical);
    expect(exact.score).toBe(5);
    expect(exact.results).toEqual([true, true, true, true, true]);

    // Zero matches (cyclically shifted so no event is at its canonical index)
    const zeroOrder = [
      canonical[1]!,
      canonical[2]!,
      canonical[3]!,
      canonical[4]!,
      canonical[0]!,
    ];
    const zero = calculateScore(zeroOrder, canonical);
    expect(zero.score).toBe(0);
    expect(zero.results).toEqual([false, false, false, false, false]);

    // Partial matches (indices 0 and 1 match, remaining indices do not)
    const partialOrder = [
      canonical[0]!,
      canonical[1]!,
      canonical[3]!,
      canonical[4]!,
      canonical[2]!,
    ];
    const partial = calculateScore(partialOrder, canonical);
    expect(partial.score).toBe(2);
    expect(partial.results).toEqual([true, true, false, false, false]);
  });

  it("keeps shareText empty while game is in progress", () => {
    const { result } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    expect(result.current.gameStatus).toBe("in_progress");
    expect(result.current.shareText).toBe("");
  });

  it("sorts chronologically and breaks ties by id", () => {
    const tied: TimelineEvent[] = [
      { ...puzzle.events[0]!, id: "event-b", date: "2010" },
      { ...puzzle.events[1]!, id: "event-a", date: "2010" },
      { ...puzzle.events[2]!, id: "event-c", date: "2005" },
    ];
    const sorted = getCanonicalChronologicalOrder(tied);
    expect(sorted.map((e) => e.id)).toEqual(["event-c", "event-a", "event-b"]);
  });

  it("swaps items on moveUp and moveDown and respects boundaries", () => {
    const { result } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    const original = [...result.current.orderedEventIds];

    expect(result.current.canMoveUp(0)).toBe(false);
    expect(result.current.canMoveUp(-1)).toBe(false);
    expect(result.current.canMoveDown(0)).toBe(true);
    expect(result.current.canMoveUp(4)).toBe(true);
    expect(result.current.canMoveDown(4)).toBe(false);
    expect(result.current.canMoveDown(5)).toBe(false);

    act(() => result.current.moveUp(0));
    expect(result.current.orderedEventIds).toEqual(original);

    act(() => result.current.moveDown(1));
    expect(result.current.orderedEventIds[1]).toBe(original[2]);
    expect(result.current.orderedEventIds[2]).toBe(original[1]);

    act(() => result.current.moveUp(2));
    expect(result.current.orderedEventIds).toEqual(original);
  });

  it("updates ordering via setOrder and rejects invalid arrays", () => {
    const { result } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    const reversed = [...puzzle.events].map((e) => e.id).reverse();

    act(() => result.current.setOrder(reversed));
    expect(result.current.orderedEventIds).toEqual(reversed);

    act(() => result.current.setOrder(["invalid-id"]));
    expect(result.current.orderedEventIds).toEqual(reversed);

    act(() => result.current.setOrder([...reversed.slice(0, 4), reversed[0]!]));
    expect(result.current.orderedEventIds).toEqual(reversed);
  });

  it("evaluates score and booleans on submit", () => {
    const { result } = renderHook(() => useTimelineGame(reversedPuzzle, "pt-BR"));
    const canonicalIds = result.current.canonicalOrder.map((e) => e.id);
    const partialOrder = [canonicalIds[0]!, canonicalIds[1]!, canonicalIds[4]!, canonicalIds[3]!, canonicalIds[2]!];

    act(() => result.current.setOrder(partialOrder));
    act(() => result.current.submit());

    expect(result.current.gameStatus).toBe("submitted");
    expect(result.current.score).toBe(3);
    expect(result.current.results).toEqual([true, true, false, true, false]);
    expect(result.current.shareText).toContain("Pontuação: 3/5 ⭐️");
    expect(result.current.shareText).toContain("🟩 🟩 🟥 🟩 🟥");
  });

  it("treats actions as no-ops once submitted", () => {
    const { result } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    act(() => result.current.submit());

    const submittedIds = [...result.current.orderedEventIds];
    expect(result.current.canMoveUp(1)).toBe(false);
    expect(result.current.canMoveDown(1)).toBe(false);

    act(() => result.current.moveUp(1));
    act(() => result.current.moveDown(1));
    act(() => result.current.setOrder([...submittedIds].reverse()));
    act(() => result.current.submit());

    expect(result.current.orderedEventIds).toEqual(submittedIds);
    expect(result.current.gameStatus).toBe("submitted");
  });

  it("restores completed game state from localStorage", () => {
    const key = `kpop-timeline-${puzzle.puzzle_id}`;
    const { result: firstRun } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    act(() => firstRun.current.submit());

    const { result: secondRun } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    expect(secondRun.current.gameStatus).toBe("submitted");
    expect(secondRun.current.score).toBe(5);
    expect(secondRun.current.results).toEqual([true, true, true, true, true]);
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it("discards mismatched or corrupt localStorage data", () => {
    const key = `kpop-timeline-${puzzle.puzzle_id}`;
    localStorage.setItem(key, "{ malformed json");
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    localStorage.setItem(key, JSON.stringify({ puzzleId: "wrong" }));
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    localStorage.setItem(key, JSON.stringify({
      puzzleId: puzzle.puzzle_id,
      referenceDate: "2099-01-01",
      orderedEventIds: puzzle.events.map((e) => e.id),
      submitted: true,
      score: 5,
      results: [true, true, true, true, true],
    }));
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    localStorage.setItem(key, JSON.stringify({
      puzzleId: puzzle.puzzle_id,
      referenceDate: puzzle.reference_date,
      orderedEventIds: [puzzle.events[0]!.id],
      submitted: true,
      score: 1,
      results: [true],
    }));
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    const { result } = renderHook(() => useTimelineGame(puzzle, "pt-BR"));
    expect(result.current.gameStatus).toBe("in_progress");
  });

  it("discards tampered localStorage entries with incorrect score or fabricated results", () => {
    const key = `kpop-timeline-${puzzle.puzzle_id}`;
    const canonical = getCanonicalChronologicalOrder(puzzle.events);
    const canonicalIds = canonical.map((e) => e.id);

    // Tampered score: evaluation yields 5, but stored score is 3
    localStorage.setItem(
      key,
      JSON.stringify({
        puzzleId: puzzle.puzzle_id,
        referenceDate: puzzle.reference_date,
        orderedEventIds: canonicalIds,
        submitted: true,
        score: 3,
        results: [true, true, true, true, true],
      })
    );
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    // Fabricated results: results boolean array does not match evaluation
    localStorage.setItem(
      key,
      JSON.stringify({
        puzzleId: puzzle.puzzle_id,
        referenceDate: puzzle.reference_date,
        orderedEventIds: canonicalIds,
        submitted: true,
        score: 5,
        results: [false, true, true, true, true],
      })
    );
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    // Results length mismatch
    localStorage.setItem(
      key,
      JSON.stringify({
        puzzleId: puzzle.puzzle_id,
        referenceDate: puzzle.reference_date,
        orderedEventIds: canonicalIds,
        submitted: true,
        score: 4,
        results: [true, true, true, true],
      })
    );
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();

    // Unsubmitted state in storage
    localStorage.setItem(
      key,
      JSON.stringify({
        puzzleId: puzzle.puzzle_id,
        referenceDate: puzzle.reference_date,
        orderedEventIds: canonicalIds,
        submitted: false,
        score: 5,
        results: [true, true, true, true, true],
      })
    );
    expect(loadTimelineSavedState(key, puzzle)).toBeNull();
  });

  it("formats spoiler-free share text in pt-BR and en", () => {
    const textPt = generateTimelineShareText({
      referenceDate: "2026-09-30",
      score: 4,
      totalEvents: 5,
      results: [true, true, false, true, true],
      locale: "pt-BR",
      origin: "https://kpopquiz.online/",
    });
    expect(textPt).toBe(
      "K-pop Quiz • Linha do Tempo 2026-09-30\n" +
      "Pontuação: 4/5 ⭐️\n" +
      "🟩 🟩 🟥 🟩 🟩\n" +
      "https://kpopquiz.online/pt-br/linha-do-tempo/"
    );

    const textEn = generateTimelineShareText({
      referenceDate: "2026-09-30",
      score: 5,
      totalEvents: 5,
      results: [true, true, true, true, true],
      locale: "en",
    });
    expect(textEn).toBe(
      "K-pop Quiz • Timeline 2026-09-30\n" +
      "Score: 5/5 ⭐️\n" +
      "🟩 🟩 🟩 🟩 🟩\n" +
      "https://kpopquiz.online/en/timeline/"
    );
  });
});
