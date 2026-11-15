import { useGameAnalytics } from "../../lib/game-analytics";
import { isDailyBoardRound } from "../../lib/player-stats";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Locale, TimelinePuzzle } from "../../lib/quiz-types";
import type { TimelineGameStatus } from "./types";
import { swapItems } from "./timeline-board-state";
import {
  canMoveDownAt,
  canMoveUpAt,
  eventsInOrder,
  indexTimelineEvents,
  isNewTimelineOrder,
  startingTimelineGame,
  submittedTimelineState,
} from "./timeline-game-state";
import {
  calculateScore,
  generateTimelineShareText,
  getCanonicalChronologicalOrder,
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

  const [start] = useState(() => startingTimelineGame(puzzle, initialSaved, initialDraft));
  const [orderedEventIds, setOrderedEventIds] = useState<string[]>(start.orderedEventIds);
  const [gameStatus, setGameStatus] = useState<TimelineGameStatus>(start.gameStatus);
  const [gaveUp, setGaveUp] = useState(start.gaveUp);
  const [score, setScore] = useState<number>(start.score);
  const [results, setResults] = useState<boolean[]>(start.results);

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

  const eventMap = useMemo(() => indexTimelineEvents(puzzle.events), [puzzle.events]);

  const orderedEvents = useMemo(
    () => eventsInOrder(orderedEventIds, eventMap),
    [orderedEventIds, eventMap]
  );

  const canonicalOrder = useMemo(
    () => getCanonicalChronologicalOrder(puzzle.events),
    [puzzle.events]
  );

  const canMoveUp = useCallback(
    (index: number): boolean => canMoveUpAt(gameStatus, index, orderedEvents.length),
    [gameStatus, orderedEvents.length]
  );

  const canMoveDown = useCallback(
    (index: number): boolean => canMoveDownAt(gameStatus, index, orderedEvents.length),
    [gameStatus, orderedEvents.length]
  );

  const moveUp = useCallback(
    (index: number) => {
      if (!canMoveUp(index)) return;
      analytics.start();
      movedHere.current = true;
      setOrderedEventIds((prev) => swapItems(prev, index, index - 1));
    },
    [canMoveUp]
  );

  const moveDown = useCallback(
    (index: number) => {
      if (!canMoveDown(index)) return;
      analytics.start();
      movedHere.current = true;
      setOrderedEventIds((prev) => swapItems(prev, index, index + 1));
    },
    [canMoveDown]
  );

  const setOrder = useCallback(
    (eventIds: string[]) => {
      if (!isNewTimelineOrder(gameStatus, eventIds, orderedEventIds, puzzle)) return;
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
    saveTimelineState(storageKey, submittedTimelineState(puzzle, orderedEventIds, evaluation, abandoned));
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
