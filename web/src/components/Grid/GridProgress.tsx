import type { Messages } from "../../i18n/catalog";

export interface GridProgressProps {
  guessesLeft: number;
  solvedCount: number;
  messages: Messages;
}

export function GridProgress({ guessesLeft, solvedCount, messages }: GridProgressProps) {
  return (
    <div class="grid-progress">
      <p>{messages.gridGuessesLeft(guessesLeft)}</p>
      <p>{messages.gridCorrectCount(solvedCount, 9)}</p>
    </div>
  );
}
