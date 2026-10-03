import type { ConnectionsPuzzle, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { ConnectionsGameStatus, GuessResult } from "./types";

export type ConnectionsFeedback =
  | { kind: "solved"; categoryId: string }
  | { kind: "wrong" | "oneAway" | "repeat" }
  // n changes on every share, so the same message is announced again.
  | { kind: "copied" | "shareFailed"; n: number };

export function feedbackFromGuess(result: GuessResult): ConnectionsFeedback {
  if (result.success && result.category) {
    return { kind: "solved", categoryId: result.category.id };
  }
  if (result.alreadyGuessed) return { kind: "repeat" };
  return { kind: result.oneAway ? "oneAway" : "wrong" };
}

export function connectionsBarState(
  isGameOver: boolean,
  gameStatus: ConnectionsGameStatus,
  feedback: ConnectionsFeedback | null,
): string {
  if (isGameOver) return gameStatus === "won" ? " is-correct" : " is-incorrect";
  if (feedback?.kind === "solved") return " is-correct";
  if (feedback?.kind === "wrong" || feedback?.kind === "oneAway") return " is-incorrect";
  return "";
}

export function ConnectionsFeedbackMessage({
  isGameOver,
  feedback,
  puzzle,
  locale,
  messages,
}: {
  isGameOver: boolean;
  feedback: ConnectionsFeedback | null;
  puzzle: ConnectionsPuzzle;
  locale: Locale;
  messages: Messages;
}) {
  if (isGameOver) {
    // A new key replaces the paragraph, so a second copy is announced again.
    if (feedback?.kind === "copied") {
      return <p key={feedback.n}>{messages.copiedToClipboard}</p>;
    }
    if (feedback?.kind === "shareFailed") {
      return <p key={feedback.n}>{messages.shareFailed}</p>;
    }
    return null;
  }

  if (feedback?.kind === "solved") {
    const category = puzzle.categories.find((c) => c.id === feedback.categoryId);
    if (!category) return null;
    return (
      <p class="connections-feedback">
        <strong class="game-actions-title">
          {messages.connectionsSolved(category.label[locale] || category.label["pt-BR"])}
        </strong>{" "}
        {category.explanation[locale] || category.explanation["pt-BR"]}
      </p>
    );
  }

  if (feedback?.kind === "oneAway") {
    return <p class="connections-feedback game-actions-title">{messages.connectionsOneAway}</p>;
  }
  if (feedback?.kind === "wrong") {
    return <p class="connections-feedback game-actions-title">{messages.connectionsWrong}</p>;
  }
  if (feedback?.kind === "repeat") {
    return <p class="connections-feedback game-actions-title">{messages.connectionsAlreadyGuessed}</p>;
  }
  return <p class="game-actions-hint">{messages.connectionsHint}</p>;
}
