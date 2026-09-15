import type { PlayMode, QuizClue } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";

export interface HintTrayProps {
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

  return (
    <div class="quiz-hint-tray">
      {activeClueIds.map((id) => {
        const clue = cluesAvailable.find((item) => item.id === id);
        return clue ? (
          <p class="quiz-clue" id={`clue-${id}`} key={id} role="status" aria-live="polite">
            <strong>{messages.clue}:</strong> {clue.text}
          </p>
        ) : null;
      })}
      {canShowRevealButton && (
        <button
          class="secondary-action"
          type="button"
          disabled={answered || !nextClue}
          aria-controls={cluesAvailable.map((clue) => `clue-${clue.id}`).join(" ")}
          onClick={onRevealClue}
        >
          {nextClue ? messages.revealClue(hintCost) : messages.clueRevealed}
        </button>
      )}
    </div>
  );
}
