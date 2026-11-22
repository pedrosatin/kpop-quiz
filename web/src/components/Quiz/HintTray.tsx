import type { PlayMode, QuizClue } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export interface HintTrayProps {
  /** The question on screen; the no-clue line is announced again for each one. */
  questionId: string;
  playMode: PlayMode;
  cluesAvailable: QuizClue[];
  cluesShown: string[];
  revealedClues: string[];
  hintCost: number;
  answered: boolean;
  onRevealClue: () => void;
  messages: Messages;
}

export function HintTray({
  questionId,
  playMode,
  cluesAvailable,
  cluesShown,
  revealedClues,
  hintCost,
  answered,
  onRevealClue,
  messages,
}: HintTrayProps) {
  const activeClueIds = [...new Set([...cluesShown, ...revealedClues])];
  const canShowRevealButton = playMode === "standard" && cluesAvailable.length > 0;
  const nextClue = cluesAvailable.find((clue) => !revealedClues.includes(clue.id));

  const noClue = cluesAvailable.length === 0 && playMode !== "expert";
  if (activeClueIds.length === 0 && !canShowRevealButton) {
    if (!noClue) return null;
    return (
      <div class="quiz-hint-tray" id="quiz-hint-tray">
        <p class="quiz-clue--absent" data-testid="quiz-no-clue" role="status" aria-live="polite">
          <span key={questionId}>{messages.noClue}</span>
        </p>
      </div>
    );
  }

  return (
    <div class="quiz-hint-tray" id="quiz-hint-tray">
      {activeClueIds.map((id) => {
        const clue = cluesAvailable.find((item) => item.id === id);
        return clue ? (
          <p class="callout quiz-clue" id={`clue-${id}`} key={id} role="status" aria-live="polite">
            <strong>{messages.clue}:</strong> {clue.text}
          </p>
        ) : null;
      })}
      {canShowRevealButton && (
        <button
          class="btn btn-secondary"
          type="button"
          disabled={answered || !nextClue}
          aria-controls={
            activeClueIds.length > 0
              ? activeClueIds.map((id) => `clue-${id}`).join(" ")
              : "quiz-hint-tray"
          }
          onClick={onRevealClue}
        >
          {nextClue ? messages.revealClue(hintCost) : messages.clueRevealed}
        </button>
      )}
    </div>
  );
}
