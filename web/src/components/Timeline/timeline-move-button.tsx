import type { MoveDirection } from "./timeline-board-state";

interface TimelineMoveButtonProps {
  eventId: string;
  direction: MoveDirection;
  label: string;
  disabled: boolean;
  onMove: () => void;
}

const ARROWS: Record<MoveDirection, string> = { up: "↑", down: "↓" };

/** Cancels the repeated keydowns of a held key. */
function ignoreRepeat(e: KeyboardEvent) {
  if (e.repeat) e.preventDefault();
}

/** A card's up or down button. Its id is where the board puts focus back after a move. */
export function TimelineMoveButton({ eventId, direction, label, disabled, onMove }: TimelineMoveButtonProps) {
  return (
    <button
      type="button"
      id={`timeline-move-${direction}-${eventId}`}
      class={`btn btn-icon timeline-btn timeline-btn-${direction}`}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onMove();
      }}
      onKeyDown={ignoreRepeat}
    >
      {ARROWS[direction]}
    </button>
  );
}
