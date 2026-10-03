import type { Messages } from "../../i18n/catalog";

export type GridFeedback =
  | { kind: "right" | "wrong"; name: string; n: number }
  // n changes on every share, so the same message is announced again.
  | { kind: "copied" | "shareFailed"; n: number };

export function gridBarState(isComplete: boolean, feedback: GridFeedback | null): string {
  if (isComplete) return "";
  if (feedback?.kind === "right") return " is-correct";
  if (feedback?.kind === "wrong") return " is-incorrect";
  return "";
}

export function GridFeedbackMessage({
  isComplete,
  feedback,
  guessesLeft,
  solvedCount,
  messages,
}: {
  isComplete: boolean;
  feedback: GridFeedback | null;
  guessesLeft: number;
  solvedCount: number;
  messages: Messages;
}) {
  if (isComplete) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (feedback?.kind === "copied") {
      return <p key={feedback.n}>{messages.copiedToClipboard}</p>;
    }
    if (feedback?.kind === "shareFailed") {
      return <p key={feedback.n}>{messages.shareFailed}</p>;
    }
    return null;
  }

  if (feedback?.kind === "right" || feedback?.kind === "wrong") {
    return (
      <p key={feedback.n} class="game-actions-title">
        {feedback.kind === "right" ? messages.gridGuessRight(feedback.name) : messages.gridGuessWrong(feedback.name)}
        <span class="visually-hidden">
          {" "}
          {messages.gridGuessesLeft(guessesLeft)}. {messages.gridCorrectCount(solvedCount, 9)}.
        </span>
      </p>
    );
  }

  return <p class="game-actions-hint">{messages.gridHint}</p>;
}
