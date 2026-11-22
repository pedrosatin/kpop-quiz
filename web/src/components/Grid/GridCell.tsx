import type { GridCriterion, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import type { GridCellState } from "./types";

export interface GridCellProps {
  row: number;
  col: number;
  rowCriterion: GridCriterion;
  colCriterion: GridCriterion;
  cellState: GridCellState;
  isSelected: boolean;
  disabled: boolean;
  onSelect: (event: MouseEvent) => void;
  locale: Locale;
  messages: Messages;
  /** First accepted answer to show when the game ended by give-up. */
  revealedName?: string | undefined;
}

export function GridCell({
  row,
  col,
  rowCriterion,
  colCriterion,
  cellState,
  isSelected,
  disabled,
  onSelect,
  locale,
  messages,
  revealedName,
}: GridCellProps) {
  const revealed = !cellState.solved && revealedName !== undefined;
  let statusText = messages.gridCellEmpty;
  if (cellState.solved && cellState.entityName) {
    statusText = messages.gridCellSolved(cellState.entityName);
  } else if (revealed) {
    statusText = messages.gridCellRevealed(revealedName);
  } else if (cellState.failed) {
    statusText = messages.gridCellFailed(cellState.lastAttempt);
  }

  const rowLabel = rowCriterion.label[locale];
  const colLabel = colCriterion.label[locale];
  const ariaLabel = messages.gridCellLabel(row, col, rowLabel, colLabel, statusText);

  const cellClasses = [
    "grid-cell-btn",
    cellState.solved ? "solved" : "",
    !revealed && cellState.failed ? "failed" : "",
    revealed ? "revealed" : "",
    isSelected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inactive = disabled || cellState.solved;

  return (
    <button
      type="button"
      class={cellClasses}
      onClick={(event) => {
        if (!inactive) onSelect(event);
      }}
      onKeyDown={(event) => {
        if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
      }}
      aria-disabled={inactive}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      data-row={row}
      data-col={col}
    >
      {cellState.solved && cellState.entityName && (
        <span class="cell-solved-name">
          <span class="cell-icon" aria-hidden="true">✓</span>
          <strong>{cellState.entityName}</strong>
        </span>
      )}
      {revealed && (
        <span class="cell-revealed-name">
          <strong>{revealedName}</strong>
        </span>
      )}
      {!revealed && !cellState.solved && cellState.failed && (
        <span class="cell-failed-status">
          <span class="cell-icon" aria-hidden="true">✕</span>
          <span class="cell-attempt-text">{cellState.lastAttempt}</span>
        </span>
      )}
      {!revealed && !cellState.solved && !cellState.failed && !disabled && (
        <span class="cell-empty-prompt" aria-hidden="true">
          +
        </span>
      )}
    </button>
  );
}
