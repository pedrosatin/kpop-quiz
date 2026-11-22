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
import { connectionsMatchId, useConnectionsGame } from "./useConnectionsGame";
import { dailyBoardRound, useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useGiveUpConfirm } from "../../lib/use-give-up-confirm";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

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
    giveUp,
  } = useConnectionsGame(puzzle, locale);

  const boardItems = useMemo(() => {
    return boardItemIds
      .map((id) => puzzle.items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i));
  }, [puzzle, boardItemIds]);

  const isGameOver = gameStatus === "won" || gameStatus === "lost";

  const [feedback, setFeedback] = useState<ConnectionsFeedback | null>(null);
  const shares = useRef(0);

  const playedHere = useRef(false);
  const lastSubmitAt = useRef(-Infinity);
  const grid = useRef<HTMLDivElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const [solvedHere, setSolvedHere] = useState(0);

  const toggle = useCallback(
    (id: string) => {
      setFeedback(null);
      toggleSelectItem(id);
    },
    [toggleSelectItem],
  );

  const clear = useCallback(() => {
    setFeedback(null);
    clearSelection();
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [clearSelection]);

  const submit = useCallback(() => {
    const now = performance.now();
    if (now - lastSubmitAt.current < SUBMIT_GUARD_MS) return;
    lastSubmitAt.current = now;
    playedHere.current = true;
    const next = feedbackFromGuess(submitGuess());
    setFeedback(next);
    if (next.kind === "solved") setSolvedHere((n) => n + 1);
  }, [submitGuess]);

  const { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp } = useGiveUpConfirm();
  const giveUpHere = () => {
    playedHere.current = true;
    setFeedback(null);
    giveUp();
  };

  const refocusBoard = !isGameOver && solvedHere > 0;
  useEffect(() => {
    if (!refocusBoard) return;
    grid.current?.querySelector<HTMLButtonElement>(".connections-tile")?.focus({ preventScroll: true });
  }, [refocusBoard, solvedHere]);
  useFocusOnChange(resultTitle, isGameOver && playedHere.current);

  useRecordDailyMatch(
    "connections",
    dailyBoardRound(puzzle, connectionsMatchId(puzzle)),
    isGameOver,
    gameStatus === "won",
  );
  const dayDone = useDailyMatchDone("connections", puzzle.reference_date, connectionsMatchId(puzzle), isGameOver);

  const barState = connectionsBarState(isGameOver, gameStatus, feedback);

  if (dayDone) return <DailyDone game="connections" locale={locale} referenceDate={puzzle.reference_date} />;

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

        <div class={`game-actions connections-actions${barState}`}>
          <MistakesRemaining
            mistakesRemaining={mistakesRemaining}
            messages={messages}
            hiddenVisually={isGameOver}
          />
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
              onGiveUp={requestGiveUp}
              messages={messages}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmGiveUpOpen}
        title={messages.giveUpConfirmTitle}
        body={messages.giveUpConfirmBody}
        confirmLabel={messages.giveUpConfirmAction}
        cancelLabel={messages.cancel}
        onConfirm={() => confirmGiveUp(giveUpHere)}
        onCancel={closeGiveUpConfirm}
      />
    </section>
  );
}
