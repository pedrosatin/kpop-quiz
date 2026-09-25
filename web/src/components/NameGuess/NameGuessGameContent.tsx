import { useEffect, useRef } from "preact/hooks";
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

  // Physical keyboard listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Enter") {
        submitGuess();
      } else if (e.key === "Backspace") {
        removeLetter();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        addLetter(e.key);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submitGuess, removeLetter, addLetter]);

  const attemptsUsed = guesses.length;
  const attemptsRemaining = puzzle.max_attempts - attemptsUsed;
  const isGameOver = status === "won" || status === "lost";

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

  return (
    <section
      id="name-guess"
      aria-label={t.title}
      class={`name-guess-shell ${highContrast ? "high-contrast" : ""}`.trim()}
      data-contrast={highContrast ? "high" : "normal"}
    >
      <div class="name-guess-container">
        {/* Game Header */}
        <div class="name-guess-header">
          <div class="name-guess-header-info">
            <h1 class="name-guess-title">
              {t.title}
            </h1>
            <p class="name-guess-subtitle">
              {t.subtitle} · {puzzle.reference_date}
            </p>
          </div>

          <div class="name-guess-controls">
            <button
              type="button"
              onClick={toggleHighContrast}
              aria-pressed={highContrast}
              class="contrast-toggle-btn"
            >
              {t.highContrast}
            </button>
          </div>
        </div>

        {/* Attempts Remaining */}
        {!isGameOver && (
          <div
            role="status"
            aria-live="polite"
            class="name-guess-attempts"
          >
            {t.attemptsLeft}: {attemptsRemaining}/{puzzle.max_attempts}
          </div>
        )}

        {/* Reserving this region keeps the board in place when validation fails. */}
        <div class="name-guess-error-region">
          {errorDisplay && (
            <div role="alert" class="name-guess-error-alert">
              {errorDisplay}
            </div>
          )}
        </div>

        {/* Grid Board */}
        <NameGuessBoard
          wordLength={puzzle.word_length}
          maxAttempts={puzzle.max_attempts}
          guesses={guesses}
          feedbacks={feedbacks}
          currentInput={currentInput}
          highContrast={highContrast}
          t={t}
        />

        {/* Results Screen */}
        {isGameOver && (
          <NameGuessResults
            puzzle={puzzle}
            guesses={guesses}
            feedbacks={feedbacks}
            status={status}
            locale={locale}
            highContrast={highContrast}
            t={t}
            onReset={resetGame}
          />
        )}

        {/* Virtual Keyboard */}
        <VirtualKeyboard
          keyStatuses={keyStatuses}
          onChar={addLetter}
          onEnter={submitGuess}
          onBackspace={removeLetter}
          highContrast={highContrast}
          t={t}
          disabled={isGameOver}
        />
      </div>
    </section>
  );
}
