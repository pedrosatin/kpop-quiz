import { useCallback, useMemo, useState } from "preact/hooks";
import type { Locale, TimelineEvent, TimelinePuzzle } from "../../lib/quiz-types";
import type { TimelineGameStatus } from "./types";
import {
  calculateScore,
  generateTimelineShareText,
  getCanonicalChronologicalOrder,
  loadTimelineSavedState,
  saveTimelineState,
} from "./timeline-utils";

export function useTimelineGame(
  puzzle: TimelinePuzzle,
  locale: Locale
) {
  const storageKey = `kpop-timeline-${puzzle.puzzle_id}`;

  const initialSaved = useMemo(
    () => loadTimelineSavedState(storageKey, puzzle),
    [storageKey, puzzle]
  );

  const [orderedEventIds, setOrderedEventIds] = useState<string[]>(
    () => initialSaved?.orderedEventIds ?? puzzle.events.map((e) => e.id)
  );
  const [gameStatus, setGameStatus] = useState<TimelineGameStatus>(
    () => (initialSaved?.submitted ? "submitted" : "in_progress")
  );
  const [score, setScore] = useState<number>(() => initialSaved?.score ?? 0);
  const [results, setResults] = useState<boolean[]>(() => initialSaved?.results ?? []);

  const eventMap = useMemo(() => {
    const map = new Map<string, TimelineEvent>();
    for (const event of puzzle.events) {
      map.set(event.id, event);
    }
    return map;
  }, [puzzle.events]);

  const orderedEvents = useMemo(() => {
    return orderedEventIds
      .map((id) => eventMap.get(id))
      .filter((event): event is TimelineEvent => Boolean(event));
  }, [orderedEventIds, eventMap]);

  const canonicalOrder = useMemo(
    () => getCanonicalChronologicalOrder(puzzle.events),
    [puzzle.events]
  );

  const canMoveUp = useCallback(
    (index: number): boolean => {
      return gameStatus === "in_progress" && index > 0 && index < orderedEvents.length;
    },
    [gameStatus, orderedEvents.length]
  );

  const canMoveDown = useCallback(
    (index: number): boolean => {
      return (
        gameStatus === "in_progress" &&
        index >= 0 &&
        index < orderedEvents.length - 1
      );
    },
    [gameStatus, orderedEvents.length]
  );

  const moveUp = useCallback(
    (index: number) => {
      if (!canMoveUp(index)) return;
      setOrderedEventIds((prev) => {
        const next = [...prev];
        const current = next[index]!;
        next[index] = next[index - 1]!;
        next[index - 1] = current;
        return next;
      });
    },
    [canMoveUp]
  );

  const moveDown = useCallback(
    (index: number) => {
      if (!canMoveDown(index)) return;
      setOrderedEventIds((prev) => {
        const next = [...prev];
        const current = next[index]!;
        next[index] = next[index + 1]!;
        next[index + 1] = current;
        return next;
      });
    },
    [canMoveDown]
  );

  const setOrder = useCallback(
    (eventIds: string[]) => {
      if (gameStatus !== "in_progress") return;
      if (!Array.isArray(eventIds) || eventIds.length !== puzzle.events.length) return;
      const validIds = new Set(puzzle.events.map((e) => e.id));
      if (eventIds.some((id) => !validIds.has(id))) return;
      if (new Set(eventIds).size !== puzzle.events.length) return;
      setOrderedEventIds(eventIds);
    },
    [gameStatus, puzzle.events]
  );

  const submit = useCallback(() => {
    if (gameStatus !== "in_progress") return;
    const evaluation = calculateScore(orderedEvents, canonicalOrder);
    setScore(evaluation.score);
    setResults(evaluation.results);
    setGameStatus("submitted");
    saveTimelineState(storageKey, {
      puzzleId: puzzle.puzzle_id,
      referenceDate: puzzle.reference_date,
      orderedEventIds,
      submitted: true,
      score: evaluation.score,
      results: evaluation.results,
    });
  }, [gameStatus, orderedEvents, canonicalOrder, storageKey, puzzle, orderedEventIds]);

  const shareText = useMemo(() => {
    if (gameStatus !== "submitted") return "";
    return generateTimelineShareText({
      referenceDate: puzzle.reference_date,
      score,
      totalEvents: puzzle.events.length,
      results,
      locale,
    });
  }, [gameStatus, puzzle.reference_date, score, puzzle.events.length, results, locale]);

  return {
    orderedEvents,
    orderedEventIds,
    gameStatus,
    score,
    results,
    canonicalOrder,
    canMoveUp,
    canMoveDown,
    moveUp,
    moveDown,
    setOrder,
    submit,
    shareText,
  };
}
