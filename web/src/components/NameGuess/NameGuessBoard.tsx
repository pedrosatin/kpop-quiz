import { NameGuessRow } from "./NameGuessRow";
import type { LetterStatus } from "./types";

interface NameGuessBoardProps {
  wordLength: number;
  maxAttempts: number;
  guesses: string[];
  feedbacks: LetterStatus[][];
  currentInput: string;
  highContrast: boolean;
}

export function NameGuessBoard({
  wordLength,
  maxAttempts,
  guesses,
  feedbacks,
  currentInput,
  highContrast,
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
        highContrast={highContrast}
        rowIndex={r}
      />
    );
  }

  return (
    <div
      role="region"
      aria-label="Grade de palpites"
      class="flex flex-col items-center justify-center p-2 sm:p-4 my-2"
    >
      {rows}
    </div>
  );
}
