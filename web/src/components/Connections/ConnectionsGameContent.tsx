import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ConnectionsPuzzle, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { ConnectionsBoard } from "./ConnectionsBoard";
import { ConnectionsControls } from "./ConnectionsControls";
import { ConnectionsResults } from "./ConnectionsResults";
import { MistakesRemaining } from "./MistakesRemaining";
import {
  ConnectionsFeedbackMessage,
  connectionsBarState,
  feedbackFromGuess,
  type ConnectionsFeedback,
} from "./connections-feedback";
import { useConnectionsGame } from "./useConnectionsGame";
import { useRecordConnectionsMatch } from "./useRecordConnectionsMatch";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

export interface ConnectionsGameContentProps {
  puzzle: ConnectionsPuzzle;
  locale: Locale;
  messages: Messages;
  onReload?: () => void;
}

/** How long Submit ignores a second activation after a guess. */
export const SUBMIT_GUARD_MS = 300;

export function ConnectionsGameContent({
  puzzle,
  locale,
  messages,
}: ConnectionsGameContentProps) {
  const {
    selectedItemIds,
    solvedCategoryIds,
    mistakesRemaining,
    guessHistory,
    gameStatus,
    boardItemIds,
    toggleSelectItem,
    clearSelection,
    shuffleItems,
    submitGuess,
    restartGame,
  } = useConnectionsGame(puzzle, locale);

  const boardItems = useMemo(() => {
    return boardItemIds
      .map((id) => puzzle.items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i));
  }, [puzzle, boardItemIds]);

  const isGameOver = gameStatus === "won" || gameStatus === "lost";

  // The verdict of the last guess shows in the side panel until the next
  // tile or Clear. It never sits above the board, so the tiles do not move.
  const [feedback, setFeedback] = useState<ConnectionsFeedback | null>(null);
  const shares = useRef(0);

  // Only a game finished in this visit moves focus to the result; a game
  // restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const lastSubmitAt = useRef(-Infinity);
  const grid = useRef<HTMLDivElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const [solvedHere, setSolvedHere] = useState(0);
  const [restarts, setRestarts] = useState(0);

  const toggle = useCallback(
    (id: string) => {
      setFeedback(null);
      toggleSelectItem(id);
    },
    [toggleSelectItem],
  );

  // Clear disables itself, so focus moves to the board instead of the page.
  const clear = useCallback(() => {
    setFeedback(null);
    clearSelection();
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [clearSelection]);

  // A double click or a held Enter would send the same four names again and
  // replace the verdict with "already tried".
  const submit = useCallback(() => {
    const now = performance.now();
    if (now - lastSubmitAt.current < SUBMIT_GUARD_MS) return;
    lastSubmitAt.current = now;
    playedHere.current = true;
    const next = feedbackFromGuess(submitGuess());
    setFeedback(next);
    if (next.kind === "solved") setSolvedHere((n) => n + 1);
  }, [submitGuess]);

  const restart = useCallback(() => {
    setFeedback(null);
    restartGame();
    setRestarts((n) => n + 1);
  }, [restartGame]);

  // A solved group takes its four tiles and disables Submit, so focus moves
  // to the first tile left instead of falling to the page. Play again does
  // the same with the new board.
  const focusStep = `${solvedHere}:${restarts}`;
  const refocusBoard = !isGameOver && (solvedHere > 0 || restarts > 0);
  useEffect(() => {
    if (!refocusBoard) return;
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [refocusBoard, focusStep]);
  useFocusOnChange(resultTitle, isGameOver && playedHere.current);

  useRecordConnectionsMatch(puzzle, gameStatus, isGameOver);

  const barState = connectionsBarState(isGameOver, gameStatus, feedback);

  return (
    <section id="connections" class="game-card game-card--wide connections-game" data-testid="game-board" aria-labelledby="connections-heading">
      <h2 id="connections-heading" class="visually-hidden">
        {messages.connectionsTitle}
      </h2>

      <div class="game-layout">
        <ConnectionsBoard
          categories={puzzle.categories}
          solvedCategoryIds={solvedCategoryIds}
          boardItems={boardItems}
          allItems={puzzle.items}
          selectedItemIds={selectedItemIds}
          onToggleItem={toggle}
          disabled={isGameOver}
          gridRef={grid}
          locale={locale}
          messages={messages}
        />

        {/* The side panel: the sticky bar under the board on phones, a column
            beside it from 60rem. Mistakes, the verdict and the controls while
            playing, the result at the end; the board never moves. */}
        <div class={`game-actions connections-actions${barState}`}>
          {/* At the end the result says how many mistakes were used, so the
              line leaves the screen but stays for screen readers. */}
          <MistakesRemaining
            mistakesRemaining={mistakesRemaining}
            messages={messages}
            hiddenVisually={isGameOver}
          />
          {/* Mounted from the start so the first verdict is announced. At the end
              the result title takes the screen, and this only announces the copy. */}
          <div
            class={`game-actions-message connections-message${isGameOver ? " visually-hidden" : ""}`}
            role="status"
            aria-live="polite"
          >
            <ConnectionsFeedbackMessage
              isGameOver={isGameOver}
              feedback={feedback}
              puzzle={puzzle}
              locale={locale}
              messages={messages}
            />
          </div>
          {isGameOver ? (
            <ConnectionsResults
              puzzle={puzzle}
              gameStatus={gameStatus}
              guessHistory={guessHistory}
              mistakesRemaining={mistakesRemaining}
              onRestart={restart}
              onCopied={() => setFeedback({ kind: "copied", n: ++shares.current })}
              onShareFailed={() => setFeedback({ kind: "shareFailed", n: ++shares.current })}
              titleRef={resultTitle}
              locale={locale}
              messages={messages}
            />
          ) : (
            <ConnectionsControls
              selectedCount={selectedItemIds.length}
              onShuffle={shuffleItems}
              onClear={clear}
              onSubmit={submit}
              messages={messages}
            />
          )}
        </div>
      </div>
    </section>
  );
}
