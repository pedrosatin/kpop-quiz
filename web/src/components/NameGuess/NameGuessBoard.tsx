import type { RefObject } from "preact";
import { NameGuessRow } from "./NameGuessRow";
import type { LetterStatus, NameGuessTranslations } from "./types";

interface NameGuessBoardProps {
  wordLength: number;
  maxAttempts: number;
  guesses: string[];
  feedbacks: LetterStatus[][];
  currentInput: string;
  t: NameGuessTranslations;
  boardRef?: RefObject<HTMLDivElement> | undefined;
}

export function NameGuessBoard({
  wordLength,
  maxAttempts,
  guesses,
  feedbacks,
  currentInput,
  t,
  boardRef,
}: NameGuessBoardProps) {
  const rows = [];

  for (let r = 0; r < maxAttempts; r++) {
    const isSubmitted = r < guesses.length;
    const isCurrent = r === guesses.length;

    rows.push(
      <NameGuessRow
        key={r}
        wordLength={wordLength}
        guess={isSubmitted ? guesses[r] : undefined}
        feedback={isSubmitted ? feedbacks[r] : undefined}
        isCurrent={isCurrent}
        currentInput={isCurrent ? currentInput : undefined}
        rowIndex={r}
        t={t}
      />
    );
  }

  return (
    // tabIndex -1 lets a restart move focus here without adding a tab stop.
    <div
      {...(boardRef ? { ref: boardRef } : {})}
      tabIndex={-1}
      role="region"
      aria-label={t.boardAria}
      class="name-guess-board"
      style={`--word-length: ${wordLength}; --ng-rows: ${maxAttempts}`}
    >
      {rows}
    </div>
  );
}
