import { useCallback, useEffect, useRef } from "preact/hooks";
import type { Locale, TimelinePuzzle } from "../../lib/quiz-types";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import { useTimelineGame } from "./useTimelineGame";
import { TimelineBoard } from "./TimelineBoard";
import { TimelineResults } from "./TimelineResults";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

export interface TimelineGameContentProps {
  puzzle: TimelinePuzzle;
  locale: Locale;
}

export function TimelineGameContent({
  puzzle,
  locale,
}: TimelineGameContentProps) {
  const {
    orderedEvents,
    orderedEventIds,
    gameStatus,
    score,
    results,
    canonicalOrder,
    moveUp,
    moveDown,
    setOrder,
    submit,
    shareText,
  } = useTimelineGame(puzzle, locale);

  const playedHere = useRef(false);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, gameStatus === "submitted" && playedHere.current);

  const isButtonAction = useRef(false);

  const handleMoveUp = useCallback(
    (index: number) => {
      isButtonAction.current = true;
      moveUp(index);
    },
    [moveUp]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      isButtonAction.current = true;
      moveDown(index);
    },
    [moveDown]
  );

  const handleReorder = useCallback(
    (from: number, to: number) => {
      if (isButtonAction.current) {
        isButtonAction.current = false;
        return;
      }
      const next = [...orderedEventIds];
      const [item] = next.splice(from, 1);
      if (item) {
        next.splice(to, 0, item);
        setOrder(next);
      }
    },
    [orderedEventIds, setOrder]
  );

  const handleSubmit = useCallback(() => {
    playedHere.current = true;
    submit();
  }, [submit]);

  const gaveUpRef = useRef(false);

  const handleGiveUp = useCallback(() => {
    playedHere.current = true;
    gaveUpRef.current = true;
    submit();
  }, [submit]);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (gameStatus === "submitted") {
      const matchId = `timeline-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("timeline", matchId)) {
        // A give-up reveals the canonical order, so a correct board after
        // one still counts as played without a win.
        const isWin = !gaveUpRef.current && score === puzzle.events.length;
        recordGameFinish("timeline", isWin, puzzle.reference_date || getTodayDateString());
        markGameMatchRecorded("timeline", matchId);
        recordedMatchRef.current = matchId;
      }
    } else {
      recordedMatchRef.current = null;
      gaveUpRef.current = false;
    }
  }, [gameStatus, puzzle, score]);

  return (
    <section id="timeline" class="timeline-game" data-testid="game-board" aria-labelledby="timeline-board-heading">
      {gameStatus === "submitted" ? (
        <TimelineResults
          score={score}
          totalEvents={puzzle.events.length}
          results={results}
          canonicalEvents={canonicalOrder}
          events={orderedEvents}
          shareText={shareText}
          locale={locale}
          titleRef={resultTitle}
        />
      ) : (
        <TimelineBoard
          events={orderedEvents}
          locale={locale}
          gameStatus={gameStatus}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onReorder={handleReorder}
          onSubmit={handleSubmit}
          onGiveUp={handleGiveUp}
        />
      )}
    </section>
  );
}
