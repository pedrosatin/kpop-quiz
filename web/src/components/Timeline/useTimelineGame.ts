import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyBoardRound } from "../../lib/player-stats";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Locale, TimelineEvent, TimelinePuzzle } from "../../lib/quiz-types";
import type { TimelineGameStatus } from "./types";
import {
  calculateScore,
  generateTimelineShareText,
  getCanonicalChronologicalOrder,
  getInitialTimelineEventIds,
  isEventOrderOf,
  loadTimelineDraft,
  loadTimelineSavedState,
  saveTimelineDraft,
  saveTimelineState,
} from "./timeline-utils";

export function timelineMatchId(puzzle: TimelinePuzzle): string {
  return `timeline-${puzzle.puzzle_id}`;
}

function timelineOutcome(status: TimelineGameStatus, gaveUp: boolean, perfect: boolean) {
  if (status !== "submitted") return null;
  if (gaveUp) return "give_up";
  return perfect ? "win" : "loss";
}

export function useTimelineGame(
  puzzle: TimelinePuzzle,
  locale: Locale
) {
  const storageKey = `kpop-timeline-${puzzle.puzzle_id}`;

  const initialSaved = useMemo(
    () => loadTimelineSavedState(storageKey, puzzle),
    [storageKey, puzzle]
  );

  // The order the player was building before a reload. Ignored once the
  // board has a submitted save.
  const initialDraft = useMemo(
    () => (initialSaved ? null : loadTimelineDraft(storageKey, puzzle)),
    [initialSaved, storageKey, puzzle]
  );

  const [orderedEventIds, setOrderedEventIds] = useState<string[]>(
    () => initialSaved?.orderedEventIds ?? initialDraft ?? getInitialTimelineEventIds(puzzle)
  );
  const [gameStatus, setGameStatus] = useState<TimelineGameStatus>(
    () => (initialSaved?.submitted ? "submitted" : "in_progress")
  );
  const [gaveUp, setGaveUp] = useState(initialSaved?.gaveUp === true);
  const [score, setScore] = useState<number>(() => initialSaved?.score ?? 0);
  const [results, setResults] = useState<boolean[]>(() => initialSaved?.results ?? []);

  const analytics = useGameAnalytics(
    {
      game: "timeline",
      locale,
      isDaily: () => isDailyBoardRound("timeline", puzzle, timelineMatchId(puzzle)),
      outcome: timelineOutcome(gameStatus, gaveUp, score === puzzle.events.length),
    },
    gameStatus === "submitted",
    // A draft exists only after a move, which already started the round.
    Boolean(initialSaved ?? initialDraft),
  );

  // Set by a move in this visit, so mounting never writes a draft.
  const movedHere = useRef(false);

  useEffect(() => {
    if (gameStatus !== "in_progress" || !movedHere.current) return;
    saveTimelineDraft(storageKey, puzzle, orderedEventIds);
  }, [gameStatus, orderedEventIds, storageKey, puzzle]);

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
      analytics.start();
      movedHere.current = true;
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
      analytics.start();
      movedHere.current = true;
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
      if (gameStatus !== "in_progress" || !isEventOrderOf(eventIds, puzzle)) return;
      if (eventIds.every((id, index) => id === orderedEventIds[index])) return;
      analytics.start();
      movedHere.current = true;
      setOrderedEventIds(eventIds);
    },
    [gameStatus, puzzle, orderedEventIds]
  );

  const submit = useCallback((abandoned = false) => {
    if (gameStatus !== "in_progress") return;
    analytics.start();
    const evaluation = calculateScore(orderedEvents, canonicalOrder);
    setGaveUp(abandoned);
    setScore(evaluation.score);
    setResults(evaluation.results);
    setGameStatus("submitted");
    saveTimelineState(storageKey, {
      puzzleId: puzzle.puzzle_id,
      referenceDate: puzzle.reference_date,
      orderedEventIds,
      submitted: true,
      gaveUp: abandoned,
      score: evaluation.score,
      results: evaluation.results,
    });
  }, [gameStatus, orderedEvents, canonicalOrder, storageKey, puzzle, orderedEventIds]);

  const shareText = useMemo(() => {
    if (gameStatus !== "submitted") return "";
    return generateTimelineShareText({
      referenceDate: puzzle.reference_date,
      gaveUp,
      score,
      totalEvents: puzzle.events.length,
      results,
      locale,
    });
  }, [gameStatus, puzzle.reference_date, score, puzzle.events.length, results, locale, gaveUp]);

  return {
    orderedEvents,
    orderedEventIds,
    gameStatus,
    gaveUp,
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
