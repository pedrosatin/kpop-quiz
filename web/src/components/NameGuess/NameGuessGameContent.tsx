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
  // The outcome of the last Share press; n changes on every press, so the
  // same message is announced again.
  const [shareFeedback, setShareFeedback] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);
  const restart = useCallback(() => {
    resetGame();
    setShareFeedback(null);
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

  let shareMessage = null;
  if (isGameOver && shareFeedback) {
    // A new key replaces the paragraph, so a second copy is announced again.
    shareMessage = (
      <p key={shareFeedback.n}>{shareFeedback.kind === "copied" ? t.copied : t.shareFailed}</p>
    );
  }

  const actionsState = status === "won" ? " is-correct" : status === "lost" ? " is-incorrect" : "";

  return (
    <section
      id="name-guess"
      aria-label={t.title}
      class="game-card game-card--wide name-guess"
      data-testid="game-board"
      data-contrast={highContrast ? "high" : "normal"}
    >
      <div class="game-layout">
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
        </div>

        {/* Below 60rem the sticky bar under the board holds the HUD and the
            keyboard, the result in its place at the end, and the contrast
            option follows it. From 60rem the wrapper and the bar leave no box
            (name-guess.css): the keyboard goes under the board and a narrow
            column beside them shows the HUD, the result and the option. */}
        <div class="game-layout-side">
          <div class={`game-actions name-guess-actions${actionsState}`}>
            {/* The page intro already shows the title, so the HUD only carries the date
                and the counter. The counter stays after the last guess. */}
            <div class="game-hud name-guess-hud">
              <p class="hud-item hud-label">
                {t.subtitle} · <span class="name-guess-date">{puzzle.reference_date}</span>
              </p>
              <p role="status" aria-live="polite" class="hud-item hud-value">
                {t.attemptsLeft}: {attemptsRemaining}/{puzzle.max_attempts}
              </p>
            </div>
            {/* The visible copy of the error sits over the HUD, so it never covers
                the row being typed. The live region below announces it. */}
            {errorDisplay && (
              <p class="alert-error name-guess-toast" aria-hidden="true">
                {errorDisplay}
              </p>
            )}
            {/* Mounted from the start so the first rejected guess is announced. It is
                visually hidden; the toast above shows the same text. At the end it
                announces the outcome of Share, which the result shows too. */}
            <div class="game-actions-message visually-hidden" role="status" aria-live="polite">
              {errorDisplay && <p>{errorDisplay}</p>}
              {shareMessage}
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
                onCopied={() => setShareFeedback({ kind: "copied", n: ++shares.current })}
                onShareFailed={() => setShareFeedback({ kind: "shareFailed", n: ++shares.current })}
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

          {/* A display preference, after the bar so it takes no height from the board on phones. */}
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
        </div>
      </div>
    </section>
  );
}
