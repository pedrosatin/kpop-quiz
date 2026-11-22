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
  /** Publication day of this challenge (ADR 047); equals `grid.reference_date` unless reused. */
  challengeDate: string;
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

function triedInCell(cells: Record<string, GridCellState>, selected: CellCoordinates | null): Set<string> {
  if (!selected) return new Set();
  return new Set(cells[cellKey(selected.row, selected.col)]?.triedIds);
}

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
  challengeDate,
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
  challengeDate: string;
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
            challengeDate={challengeDate}
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
  challengeDate,
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

  const [feedback, setFeedback] = useState<GridFeedback | null>(null);
  const announcements = useRef(0);

  const [focusCell, setFocusCell] = useState<{ row: number; col: number; n: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const lastGuessAt = useRef(-Infinity);

  const playedHere = useRef(false);
  const [finalVerdict, setFinalVerdict] = useState<string | null>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, isComplete && playedHere.current);

  useEffect(() => {
    if (!focusCell || isComplete) return;
    board.current
      ?.querySelector<HTMLButtonElement>(`.grid-cell-btn[data-row="${focusCell.row}"][data-col="${focusCell.col}"]`)
      ?.focus({ preventScroll: true });
  }, [focusCell, isComplete]);

  useRecordDailyMatch("grid", gridDailyRound(grid, challengeDate), isComplete, !gaveUp && isGridWin(solvedCount));
  const dayDone = useDailyMatchDone("grid", challengeDate, gridMatchId(grid, challengeDate), isComplete);

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

  if (dayDone) return <DailyDone game="grid" locale={locale} referenceDate={challengeDate} />;

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
          challengeDate={challengeDate}
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
