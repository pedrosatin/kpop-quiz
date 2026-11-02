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

  // Expert has no clues by design. Assisted and Standard say so when a
  // question has none, and show no button that could not open anything.
  const noClue = cluesAvailable.length === 0 && playMode !== "expert";
  if (activeClueIds.length === 0 && !canShowRevealButton) {
    if (!noClue || answered) return null;
    return (
      <div class="quiz-hint-tray" id="quiz-hint-tray">
        <p class="callout quiz-clue quiz-clue--absent" data-testid="quiz-no-clue" role="status" aria-live="polite">
          {playMode === "standard" ? messages.noClueStandard : messages.noClueAssisted}
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
