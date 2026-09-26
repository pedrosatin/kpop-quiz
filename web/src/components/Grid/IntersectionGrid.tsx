import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CandidateEntity, Locale } from "../../lib/quiz-types";
import { getMessages, type Messages } from "../../i18n/catalog";
import { useGridGame } from "./useGridGame";
import { GridBoard } from "./GridBoard";
import { EntityPicker } from "./EntityPicker";
import { GridResults } from "./GridResults";
import { cellKey, type GridCellState } from "./types";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

export interface IntersectionGridProps {
  locale: Locale;
  baseUrl?: string;
  messages?: Messages;
}

/** How long the cells ignore a tap after a guess closes the picker. */
export const CELL_GUARD_MS = 300;

type Feedback =
  | { kind: "right" | "wrong"; name: string; n: number }
  // n changes on every share, so the same message is announced again.
  | { kind: "copied" | "shareFailed"; n: number };

/**
 * The cell that takes focus after a guess: the same cell while it is still
 * open, else the next open cell in reading order, empty cells first.
 */
export function nextCellAfterGuess(
  cells: Record<string, GridCellState>,
  row: number,
  col: number,
): { row: number; col: number } | null {
  if (!cells[cellKey(row, col)]?.solved) return { row, col };
  const start = row * 3 + col;
  const order = Array.from({ length: 8 }, (_, i) => (start + 1 + i) % 9);
  const open = order.filter((i) => !cells[cellKey(Math.floor(i / 3), i % 3)]?.solved);
  const pick = open.find((i) => !cells[cellKey(Math.floor(i / 3), i % 3)]?.failed) ?? open[0];
  return pick === undefined ? null : { row: Math.floor(pick / 3), col: pick % 3 };
}

export function IntersectionGrid({ locale, baseUrl, messages: propMessages }: IntersectionGridProps) {
  const messages = propMessages ?? getMessages(locale);
  const {
    grid,
    status,
    errorKind,
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
    reload,
  } = useGridGame(locale, baseUrl);

  const solvedCount = useMemo(() => {
    return Object.values(cells).filter((c) => c.solved).length;
  }, [cells]);

  const isComplete = status === "complete";

  // The verdict of the last guess shows in the action bar until the next
  // one. It never sits above the board, so the cells do not move.
  const [feedback, setFeedback] = useState<Feedback | null>(null);
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
    setFeedback({ kind: result.success ? "right" : "wrong", name: result.name, n });
    if (result.finished) {
      setFinalVerdict(result.success ? messages.gridGuessRight(result.name) : messages.gridGuessWrong(result.name));
    } else {
      const target = nextCellAfterGuess(result.cells, result.row, result.col);
      if (target) setFocusCell({ ...target, n });
    }
  }, [makeGuess, messages]);

  const restart = useCallback(() => {
    setFeedback(null);
    setFinalVerdict(null);
    restartGame();
    setFocusCell({ row: 0, col: 0, n: ++announcements.current });
  }, [restartGame]);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === "complete" && grid) {
      const matchId = `grid-${grid.reference_date || grid.grid_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("grid", matchId)) {
        const isWin = solvedCount >= 5;
        recordGameFinish("grid", isWin, grid.reference_date || getTodayDateString());
        markGameMatchRecorded("grid", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (status !== "complete") {
      recordedMatchRef.current = null;
    }
  }, [status, grid, solvedCount]);

  if (status === "loading") {
    return (
      <section id="grid" class="game-card state" aria-live="polite" aria-busy="true">
        <span class="loader" aria-hidden="true" />
        <p>{messages.loading}</p>
      </section>
    );
  }

  if (status === "error" || !grid) {
    const errorMsg = errorKind === "missing" ? messages.artifactMissing : messages.loadError;
    return (
      <section id="grid" class="game-card state" aria-live="polite">
        <p>{errorMsg}</p>
        <button class="btn btn-primary" type="button" onClick={reload}>
          {messages.retry}
        </button>
      </section>
    );
  }

  const selectedRowCrit = selectedCell ? grid.row_criteria[selectedCell.row]?.label[locale] : undefined;
  const selectedColCrit = selectedCell ? grid.col_criteria[selectedCell.col]?.label[locale] : undefined;
  const guessesLeft = maxGuesses - guessesUsed;

  let message = null;
  let barState = "";
  if (isComplete) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (feedback?.kind === "copied") message = <p key={feedback.n}>{messages.copiedToClipboard}</p>;
    else if (feedback?.kind === "shareFailed") message = <p key={feedback.n}>{messages.shareFailed}</p>;
  } else if (feedback?.kind === "right" || feedback?.kind === "wrong") {
    message = (
      <p key={feedback.n} class="game-actions-title">
        {feedback.kind === "right" ? messages.gridGuessRight(feedback.name) : messages.gridGuessWrong(feedback.name)}
        <span class="visually-hidden">
          {" "}
          {messages.gridGuessesLeft(guessesLeft)}. {messages.gridCorrectCount(solvedCount, 9)}.
        </span>
      </p>
    );
    barState = feedback.kind === "right" ? " is-correct" : " is-incorrect";
  } else {
    message = <p class="game-actions-hint">{messages.gridHint}</p>;
  }

  return (
    <section id="grid" class="game-card grid-game" aria-labelledby="grid-hud-heading">
      <h2 id="grid-hud-heading" class="visually-hidden">
        {messages.gridTitle}
      </h2>

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

      {/* Verdict and counters while playing, the result at the end; the
          board above never moves. */}
      <div class={`game-actions grid-actions${barState}`}>
        {/* Mounted from the start so the first verdict is announced. At the end
            the result title takes its place, and this only announces the copy. */}
        <div
          class={`game-actions-message grid-message${isComplete ? " visually-hidden" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
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
          <div class="grid-progress">
            <p>{messages.gridGuessesLeft(guessesLeft)}</p>
            <p>{messages.gridCorrectCount(solvedCount, 9)}</p>
          </div>
        )}
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
