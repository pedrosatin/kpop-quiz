import { NameGuessRow } from "./NameGuessRow";
import type { LetterStatus, NameGuessTranslations } from "./types";

interface NameGuessBoardProps {
  wordLength: number;
  maxAttempts: number;
  guesses: string[];
  feedbacks: LetterStatus[][];
  currentInput: string;
  t: NameGuessTranslations;
}

export function NameGuessBoard({
  wordLength,
  maxAttempts,
  guesses,
  feedbacks,
  currentInput,
  t,
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
    <div
      role="region"
      aria-label={t.boardAria}
      class="name-guess-board"
      style={`--word-length: ${wordLength}`}
    >
      {rows}
    </div>
  );
}
