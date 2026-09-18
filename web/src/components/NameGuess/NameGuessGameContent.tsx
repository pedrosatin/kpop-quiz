import { useEffect } from "preact/hooks";
import type { NameGuessPuzzle, Locale } from "../../lib/quiz-types";
import { NameGuessBoard } from "./NameGuessBoard";
import { NameGuessResults } from "./NameGuessResults";
import { VirtualKeyboard } from "./VirtualKeyboard";
import type { NameGuessTranslations } from "./types";
import { useNameGuessGame } from "./useNameGuessGame";

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
      class="w-full max-w-2xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex flex-col items-center"
    >
      {/* Game Header */}
      <div class="w-full flex justify-between items-center mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            {t.title}
          </h1>
          <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {t.subtitle} · {puzzle.reference_date}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleHighContrast}
          aria-pressed={highContrast}
          class="px-2.5 py-1 text-xs sm:text-sm font-semibold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition"
        >
          {t.highContrast}: {highContrast ? "ON" : "OFF"}
        </button>
      </div>

      {/* Attempts Remaining */}
      {!isGameOver && (
        <div
          role="status"
          aria-live="polite"
          class="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 my-1"
        >
          {t.attemptsLeft}: {attemptsRemaining}/{puzzle.max_attempts}
        </div>
      )}

      {/* Transient Error Announcement */}
      {errorDisplay && (
        <div
          role="alert"
          class="my-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-xs sm:text-sm font-bold rounded shadow transition-all duration-150 animate-pulse"
        >
          {errorDisplay}
        </div>
      )}

      {/* Grid Board */}
      <NameGuessBoard
        wordLength={puzzle.word_length}
        maxAttempts={puzzle.max_attempts}
        guesses={guesses}
        feedbacks={feedbacks}
        currentInput={currentInput}
        highContrast={highContrast}
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
    </section>
  );
}
