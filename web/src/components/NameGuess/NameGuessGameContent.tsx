import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { NameGuessPuzzle, Locale } from "../../lib/quiz-types";
import { NameGuessBoard } from "./NameGuessBoard";
import { NameGuessResults } from "./NameGuessResults";
import { VirtualKeyboard } from "./VirtualKeyboard";
import type { NameGuessTranslations } from "./types";
import { nameGuessMatchId, useNameGuessGame, type ErrorCode } from "./useNameGuessGame";
import { dailyBoardRound, useRecordDailyMatch } from "../../lib/use-record-daily-match";
import { useFocusOnChange } from "../../lib/use-focus-on-change";
import { useGiveUpConfirm } from "../../lib/use-give-up-confirm";
import { getMessages } from "../../i18n/catalog";
import { formatCalendarDate } from "../../lib/format-date";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { DailyDone, useDailyMatchDone } from "../Results/DailyDone";
import { guessLetterFromKey } from "./key-letter";

function isTextEntry(el: HTMLElement): boolean {
  return (
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

function isActivatable(el: HTMLElement): boolean {
  return el.closest("button, a[href], summary, [role='button'], [role='link']") !== null;
}

function usePhysicalKeyboard(
  enabled: boolean,
  submit: () => void,
  removeLetter: () => void,
  addLetter: (letter: string) => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && isTextEntry(target)) return;
      if (e.key === "Enter") {
        if (target && isActivatable(target)) return;
        submit();
      } else if (e.key === "Backspace") {
        removeLetter();
      } else {
        const letter = guessLetterFromKey(e.key);
        if (letter) addLetter(letter);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, submit, removeLetter, addLetter]);
}

function errorText(code: ErrorCode, t: NameGuessTranslations, wordLength: number): string {
  if (code === "tooManyLetters") return t.tooManyLetters(wordLength);
  return t[code];
}

export interface NameGuessGameContentProps {
  puzzle: NameGuessPuzzle;
  locale: Locale;
  t: NameGuessTranslations;
  giveUpLabel: string;
}

export function NameGuessGameContent({ puzzle, locale, t, giveUpLabel }: NameGuessGameContentProps) {
  const messages = getMessages(locale);
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
    giveUp,
    toggleHighContrast,
  } = useNameGuessGame(puzzle, locale);

  const playedHere = useRef(false);
  const submit = useCallback(() => {
    playedHere.current = true;
    submitGuess();
  }, [submitGuess]);

  const dayDone = useDailyMatchDone("name-guess", puzzle.reference_date, nameGuessMatchId(puzzle), status !== "playing");

  usePhysicalKeyboard(!dayDone, submit, removeLetter, addLetter);

  const attemptsUsed = guesses.length;
  const attemptsRemaining = puzzle.max_attempts - attemptsUsed;
  const isGameOver = status === "won" || status === "lost";

  const resultTitle = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(resultTitle, isGameOver && playedHere.current);

  const [shareFeedback, setShareFeedback] = useState<{ kind: "copied" | "shareFailed"; n: number } | null>(null);
  const shares = useRef(0);

  const round = dailyBoardRound(puzzle, nameGuessMatchId(puzzle));
  useRecordDailyMatch("name-guess", round, isGameOver, status === "won", guesses.length);

  const errorDisplay = errorMessage ? errorText(errorMessage, t, puzzle.word_length) : null;

  const { confirmGiveUpOpen, requestGiveUp, closeGiveUpConfirm, confirmGiveUp } = useGiveUpConfirm();
  const giveUpHere = () => {
    playedHere.current = true;
    giveUp();
  };

  let shareMessage = null;
  if (isGameOver && shareFeedback) {
    shareMessage = (
      <p key={shareFeedback.n}>{shareFeedback.kind === "copied" ? t.copied : t.shareFailed}</p>
    );
  }

  const actionsState = status === "won" ? " is-correct" : status === "lost" ? " is-incorrect" : "";

  if (dayDone) return <DailyDone game="nameGuess" locale={locale} referenceDate={puzzle.reference_date} />;

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
          />
        </div>

        <div class="game-layout-side">
          <div class={`game-actions name-guess-actions${actionsState}`}>
            <div class="game-hud name-guess-hud">
              <p class="hud-item hud-label">
                {t.subtitle} · <span class="name-guess-date">{formatCalendarDate(puzzle.reference_date, locale)}</span>
              </p>
              <p role="status" aria-live="polite" class="hud-item hud-value">
                {t.attemptsLeft}: {attemptsRemaining}/{puzzle.max_attempts}
              </p>
            </div>
            {errorDisplay && (
              <p class="alert-error name-guess-toast" aria-hidden="true">
                {errorDisplay}
              </p>
            )}
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

          <div class="name-guess-options">
            {!isGameOver && (
              <button
                type="button"
                onClick={requestGiveUp}
                class="btn btn-secondary btn-sm"
              >
                {giveUpLabel}
              </button>
            )}
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
