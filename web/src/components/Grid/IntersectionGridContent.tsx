import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CandidateEntity, IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { GridBoard } from "./GridBoard";
import { EntityPicker } from "./EntityPicker";
import { GridResults } from "./GridResults";
import { GridProgress } from "./GridProgress";
import {
  GridFeedbackMessage,
  gridBarState,
  type GridFeedback,
} from "./grid-feedback";
import { CELL_GUARD_MS, nextCellAfterGuess } from "./next-cell-after-guess";
import { useRecordGridMatch } from "./useRecordGridMatch";
import { useGridGame } from "./useGridGame";
import type { CellCoordinates, GridCellState, GridGameStatus } from "./types";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

type GridGameApi = ReturnType<typeof useGridGame>;

export interface IntersectionGridContentProps {
  grid: IntersectionGrid;
  locale: Locale;
  messages: Messages;
  status: GridGameStatus;
  selectedCell: CellCoordinates | null;
  guessesUsed: number;
  maxGuesses: number;
  cells: Record<string, GridCellState>;
  usedEntityIds: Set<string>;
  uniquenessError: string | null;
  selectCell: GridGameApi["selectCell"];
  closePicker: GridGameApi["closePicker"];
  makeGuess: GridGameApi["makeGuess"];
  restartGame: GridGameApi["restartGame"];
}

export function IntersectionGridContent({
  grid,
  locale,
  messages,
  status,
  selectedCell,
  guessesUsed,
  maxGuesses,
  cells,
  usedEntityIds,
  uniquenessError,
  selectCell,
  closePicker,
  makeGuess,
  restartGame,
}: IntersectionGridContentProps) {
  const solvedCount = useMemo(() => {
    return Object.values(cells).filter((c) => c.solved).length;
  }, [cells]);

  const isComplete = status === "complete";

  // The verdict of the last guess shows in the side panel until the next
  // one. It never sits above the board, so the cells do not move.
  const [feedback, setFeedback] = useState<GridFeedback | null>(null);
  const announcements = useRef(0);

  // Focus goes back to the board after the picker closes: to the cell that
  // opened it, or to the next open cell after a right guess. n changes on
  // every close, so the same cell is focused again.
  const [focusCell, setFocusCell] = useState<{ row: number; col: number; n: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const lastGuessAt = useRef(-Infinity);

  // Only a game finished in this visit moves focus to the result; a game
  // restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  // The verdict of the guess that ended the game, shown before the result
  // summary. A restored game has none.
  const [finalVerdict, setFinalVerdict] = useState<string | null>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, isComplete && playedHere.current);

  useEffect(() => {
    if (!focusCell || isComplete) return;
    board.current
      ?.querySelector<HTMLButtonElement>(`.grid-cell-btn[data-row="${focusCell.row}"][data-col="${focusCell.col}"]`)
      ?.focus({ preventScroll: true });
  }, [focusCell, isComplete]);

  useRecordGridMatch(grid, status, solvedCount);

  // The second tap of a double tap on a group lands on the board once the
  // picker closes; it must not open the cell under it. A click from Enter or
  // Space has detail 0 and goes through; a held key is stopped by the cell.
  const openCell = useCallback((row: number, col: number, event?: MouseEvent) => {
    const fromKeyboard = event?.detail === 0;
    if (!fromKeyboard && performance.now() - lastGuessAt.current < CELL_GUARD_MS) return;
    selectCell(row, col);
  }, [selectCell]);

  const close = useCallback(() => {
    if (selectedCell) setFocusCell({ ...selectedCell, n: ++announcements.current });
    closePicker();
  }, [selectedCell, closePicker]);

  const guess = useCallback((candidate: CandidateEntity) => {
    const result = makeGuess(candidate);
    if (result.reason !== "correct" && result.reason !== "incorrect") return;
    lastGuessAt.current = performance.now();
    playedHere.current = true;
    const n = ++announcements.current;
    setFeedback({ kind: result.success ? "right" : "wrong", name: result.name!, n });
    if (result.finished) {
      setFinalVerdict(result.success ? messages.gridGuessRight(result.name!) : messages.gridGuessWrong(result.name!));
    } else {
      const target = nextCellAfterGuess(result.cells!, result.row!, result.col!);
      if (target) setFocusCell({ ...target, n });
    }
  }, [makeGuess, messages]);

  const restart = useCallback(() => {
    setFeedback(null);
    setFinalVerdict(null);
    restartGame();
    setFocusCell({ row: 0, col: 0, n: ++announcements.current });
  }, [restartGame]);

  const selectedRowCrit = selectedCell ? grid.row_criteria[selectedCell.row]?.label[locale] : undefined;
  const selectedColCrit = selectedCell ? grid.col_criteria[selectedCell.col]?.label[locale] : undefined;
  const guessesLeft = maxGuesses - guessesUsed;
  const barState = gridBarState(isComplete, feedback);

  return (
    <section id="grid" class="game-card game-card--wide grid-game" data-testid="game-board" aria-labelledby="grid-hud-heading">
      <h2 id="grid-hud-heading" class="visually-hidden">
        {messages.gridTitle}
      </h2>

      <div class="game-layout">
        <GridBoard
          grid={grid}
          cellStates={cells}
          selectedCell={selectedCell}
          onSelectCell={openCell}
          disabled={status !== "ready" && status !== "cell_selected"}
          boardRef={board}
          locale={locale}
          messages={messages}
        />

        {/* The side panel: the sticky bar under the board on phones, a column
            beside it from 60rem. The verdict and counters while playing, the
            result at the end; the board never moves. */}
        <div class={`game-actions grid-actions${barState}`}>
          {/* Mounted from the start so the first verdict is announced. At the end
              the result title takes its place, and this only announces the copy. */}
          <div
            class={`game-actions-message grid-message${isComplete ? " visually-hidden" : ""}`}
            role="status"
            aria-live="polite"
          >
            <GridFeedbackMessage
              isComplete={isComplete}
              feedback={feedback}
              guessesLeft={guessesLeft}
              solvedCount={solvedCount}
              messages={messages}
            />
          </div>
          {isComplete ? (
            <GridResults
              grid={grid}
              cellStates={cells}
              guessesUsed={guessesUsed}
              verdict={finalVerdict}
              onRestart={restart}
              onCopied={() => setFeedback({ kind: "copied", n: ++announcements.current })}
              onShareFailed={() => setFeedback({ kind: "shareFailed", n: ++announcements.current })}
              titleRef={resultTitle}
              locale={locale}
              messages={messages}
            />
          ) : (
            <GridProgress guessesLeft={guessesLeft} solvedCount={solvedCount} messages={messages} />
          )}
        </div>
      </div>

      {status === "cell_selected" && selectedCell && (
        <EntityPicker
          candidatePool={grid.candidate_pool}
          usedEntityIds={usedEntityIds}
          uniquenessError={uniquenessError}
          rowLabel={selectedRowCrit}
          colLabel={selectedColCrit}
          onSelectCandidate={guess}
          onClose={close}
          locale={locale}
          messages={messages}
        />
      )}
    </section>
  );
}
