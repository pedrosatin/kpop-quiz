import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { NameGuessPuzzle, Locale } from "../../lib/quiz-types";
import { NameGuessBoard } from "./NameGuessBoard";
import { NameGuessResults } from "./NameGuessResults";
import { VirtualKeyboard } from "./VirtualKeyboard";
import type { NameGuessTranslations } from "./types";
import { useNameGuessGame } from "./useNameGuessGame";
import {
  getTodayDateString,
  isGameMatchRecorded,
  markGameMatchRecorded,
  recordGameFinish,
} from "../../lib/player-stats";
import { useFocusOnChange } from "../../lib/use-focus-on-change";

function isTextEntry(el: HTMLElement): boolean {
  return (
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

// Letters and Backspace still reach the game from these elements, so typing keeps
// working while a virtual key has focus; only Enter belongs to them.
function isActivatable(el: HTMLElement): boolean {
  return el.closest("button, a[href], summary, [role='button'], [role='link']") !== null;
}

export interface NameGuessGameContentProps {
  puzzle: NameGuessPuzzle;
  locale: Locale;
  t: NameGuessTranslations;
}

export function NameGuessGameContent({ puzzle, locale, t }: NameGuessGameContentProps) {
  const {
    guesses,
    feedbacks,
    currentInput,
    status,
    errorMessage,
    highContrast,
    keyStatuses,
    addLetter,
    removeLetter,
    submitGuess,
    toggleHighContrast,
    resetGame,
  } = useNameGuessGame(puzzle);

  // Only a game finished in this visit moves focus to the result; a finished
  // game restored from storage leaves focus where the page put it.
  const playedHere = useRef(false);
  const submit = useCallback(() => {
    playedHere.current = true;
    submitGuess();
  }, [submitGuess]);

  // Physical keyboard listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && isTextEntry(target)) return;
      if (e.key === "Enter") {
        // Enter on a focused button already activates that button.
        if (target && isActivatable(target)) return;
        submit();
      } else if (e.key === "Backspace") {
        removeLetter();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        addLetter(e.key);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submit, removeLetter, addLetter]);

  const attemptsUsed = guesses.length;
  const attemptsRemaining = puzzle.max_attempts - attemptsUsed;
  const isGameOver = status === "won" || status === "lost";

  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, isGameOver && playedHere.current);

  // Play again removes the focused button, so focus moves to the empty board
  // and a screen reader announces the new game.
  const board = useRef<HTMLDivElement>(null);
  const [restarts, setRestarts] = useState(0);
  const restart = useCallback(() => {
    resetGame();
    setRestarts((n) => n + 1);
  }, [resetGame]);
  useFocusOnChange(board, restarts > 0, restarts);

  const recordedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (isGameOver && puzzle) {
      const matchId = `name-guess-${puzzle.puzzle_id}`;
      if (recordedMatchRef.current !== matchId && !isGameMatchRecorded("name-guess", matchId)) {
        const isWin = status === "won";
        const guessCount = guesses.length;
        recordGameFinish("name-guess", isWin, puzzle.reference_date || getTodayDateString(), guessCount);
        markGameMatchRecorded("name-guess", matchId);
        recordedMatchRef.current = matchId;
      }
    } else if (!isGameOver) {
      recordedMatchRef.current = null;
    }
  }, [isGameOver, status, puzzle, guesses.length]);

  let errorDisplay = null;
  if (errorMessage === "notEnoughLetters") {
    errorDisplay = t.notEnoughLetters;
  } else if (errorMessage === "notInWordList") {
    errorDisplay = t.notInWordList;
  }

  const actionsState = status === "won" ? " is-correct" : status === "lost" ? " is-incorrect" : "";

  return (
    <>
      <section
        id="name-guess"
        aria-label={t.title}
        class="game-card name-guess"
        data-contrast={highContrast ? "high" : "normal"}
      >
        {/* The page intro already shows the title, so the HUD only carries the date and
            the counter. The counter stays after the last guess, so the HUD keeps its height. */}
        <div class="game-hud name-guess-hud">
          <p class="hud-item hud-label">
            {t.subtitle} · <span class="name-guess-date">{puzzle.reference_date}</span>
          </p>
          <p role="status" aria-live="polite" class="hud-item hud-value">
            {t.attemptsLeft}: {attemptsRemaining}/{puzzle.max_attempts}
          </p>
        </div>

        <div class="name-guess-play">
          <NameGuessBoard
            wordLength={puzzle.word_length}
            maxAttempts={puzzle.max_attempts}
            guesses={guesses}
            feedbacks={feedbacks}
            currentInput={currentInput}
            t={t}
            boardRef={board}
          />
          {/* The visible copy of the error sits over the HUD, above the first row,
              so it never covers the row being typed. The bar's live region below
              announces it. */}
          {errorDisplay && (
            <p class="alert-error name-guess-toast" aria-hidden="true">
              {errorDisplay}
            </p>
          )}
        </div>

        {/* The keyboard is the game's action bar; the result takes its place at the end. */}
        <div class={`game-actions name-guess-actions${actionsState}`}>
          {/* Mounted from the start so the first rejected guess is announced. It is
              visually hidden; the toast above the board shows the same text. */}
          <div class="game-actions-message visually-hidden" role="status" aria-live="polite">
            {errorDisplay && <p>{errorDisplay}</p>}
          </div>
          {isGameOver ? (
            <NameGuessResults
              puzzle={puzzle}
              guesses={guesses}
              feedbacks={feedbacks}
              status={status}
              locale={locale}
              highContrast={highContrast}
              t={t}
              onReset={restart}
              titleRef={resultTitle}
            />
          ) : (
            <VirtualKeyboard
              keyStatuses={keyStatuses}
              onChar={addLetter}
              onEnter={submit}
              onBackspace={removeLetter}
              t={t}
            />
          )}
        </div>
      </section>

      {/* A display preference, kept out of the card so it takes no height from the board. */}
      <div class="name-guess-options">
        <button
          type="button"
          onClick={toggleHighContrast}
          aria-pressed={highContrast}
          class="btn btn-secondary btn-sm"
        >
          {t.highContrast}
        </button>
      </div>
    </>
  );
}
