import type { Ref } from "preact";
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
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useGiveUpConfirm } from "../../lib/use-give-up-confirm";
import { useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";
import { cellKey, type CellCoordinates, type GridCellState, type GridGameStatus } from "./types";
import { gridDailyRound, gridMatchId, isGridWin, useGridGame } from "./useGridGame";

type GridGameApi = ReturnType<typeof useGridGame>;

export interface IntersectionGridContentProps {
  grid: IntersectionGrid;
  /** Same-day correction notice; lives inside the card so the desktop panel stays on screen. */
  corrected?: boolean;
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
  giveUp: GridGameApi["giveUp"];
  gaveUp: GridGameApi["gaveUp"];
}

/** The groups already refused in the selected cell. */
function triedInCell(cells: Record<string, GridCellState>, selected: CellCoordinates | null): Set<string> {
  if (!selected) return new Set();
  return new Set(cells[cellKey(selected.row, selected.col)]?.triedIds);
}

/**
 * Side column: sticky bar under the board on phones, a column beside it from
 * 60rem. A same-day correction notice lives here so it does not push Give up
 * under the fold at desktop height.
 */
function GridSideColumn({
  corrected,
  correctionText,
  barState,
  isComplete,
  feedback,
  guessesLeft,
  solvedCount,
  messages,
  grid,
  cells,
  guessesUsed,
  finalVerdict,
  gaveUp,
  onCopied,
  onShareFailed,
  titleRef,
  locale,
  onGiveUp,
}: {
  corrected: boolean;
  correctionText: string;
  barState: string;
  isComplete: boolean;
  feedback: GridFeedback | null;
  guessesLeft: number;
  solvedCount: number;
  messages: Messages;
  grid: IntersectionGrid;
  cells: Record<string, GridCellState>;
  guessesUsed: number;
  finalVerdict: string | null;
  gaveUp: boolean;
  onCopied: () => void;
  onShareFailed: () => void;
  titleRef: Ref<HTMLHeadingElement>;
  locale: Locale;
  onGiveUp: () => void;
}) {
  return (
    <div class="game-layout-side">
      {corrected && (
        <aside class="grid-correction" role="status" data-testid="grid-correction">
          <p>{correctionText}</p>
        </aside>
      )}
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
            gaveUp={gaveUp}
            onCopied={onCopied}
            onShareFailed={onShareFailed}
            titleRef={titleRef}
            locale={locale}
            messages={messages}
          />
        ) : (
          <>
            <GridProgress guessesLeft={guessesLeft} solvedCount={solvedCount} messages={messages} />
            <button type="button" class="btn btn-secondary" onClick={onGiveUp}>
              {messages.giveUp}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function IntersectionGridContent({
  grid,
  corrected = false,
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
  giveUp,
  gaveUp,
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

  useRecordDailyMatch("grid", gridDailyRound(grid), isComplete, !gaveUp && isGridWin(solvedCount));
  const dayDone = useDailyMatchDone("grid", grid.reference_date, gridMatchId(grid), isComplete);

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
    if (result.reason === "already_tried") {
      // Nothing is spent: the picker closes on the same cell and the bar
      // says why, so the player sees the guesses left did not move.
      lastGuessAt.current = performance.now();
      setFeedback({ kind: "repeat", name: result.name, n: ++announcements.current });
      close();
      return;
    }
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
  }, [makeGuess, messages, close]);

  const { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp } = useGiveUpConfirm();
  const giveUpHere = () => {
    playedHere.current = true;
    setFeedback(null);
    setFinalVerdict(null);
    giveUp();
  };

  const triedHere = useMemo(() => triedInCell(cells, selectedCell), [cells, selectedCell]);

  const selectedRowCrit = selectedCell ? grid.row_criteria[selectedCell.row]?.label[locale] : undefined;
  const selectedColCrit = selectedCell ? grid.col_criteria[selectedCell.col]?.label[locale] : undefined;
  const guessesLeft = maxGuesses - guessesUsed;
  const barState = gridBarState(isComplete, feedback);

  if (dayDone) return <DailyDone game="grid" locale={locale} referenceDate={grid.reference_date} />;

  return (
    <section
      id="grid"
      class={`game-card game-card--wide grid-game${corrected ? " grid-game--corrected" : ""}`}
      data-testid="game-board"
      aria-labelledby="grid-hud-heading"
    >
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
          revealed={gaveUp}
        />

        <GridSideColumn
          corrected={corrected}
          correctionText={messages.gridCorrected}
          barState={barState}
          isComplete={isComplete}
          feedback={feedback}
          guessesLeft={guessesLeft}
          solvedCount={solvedCount}
          messages={messages}
          grid={grid}
          cells={cells}
          guessesUsed={guessesUsed}
          finalVerdict={finalVerdict}
          gaveUp={gaveUp}
          onCopied={() => setFeedback({ kind: "copied", n: ++announcements.current })}
          onShareFailed={() => setFeedback({ kind: "shareFailed", n: ++announcements.current })}
          titleRef={resultTitle}
          locale={locale}
          onGiveUp={requestGiveUp}
        />
      </div>

      {status === "cell_selected" && selectedCell && (
        <EntityPicker
          candidatePool={grid.candidate_pool}
          usedEntityIds={usedEntityIds}
          triedEntityIds={triedHere}
          uniquenessError={uniquenessError}
          rowLabel={selectedRowCrit}
          colLabel={selectedColCrit}
          onSelectCandidate={guess}
          onClose={close}
          locale={locale}
          messages={messages}
        />
      )}

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
