import { cellClass } from "./pointer";

interface WordSearchCellProps {
  row: number;
  col: number;
  letter: string;
  /** Index of the found word's color, or undefined. */
  color: number | undefined;
  selected: boolean;
  revealed: boolean;
  anchor: boolean;
  /** The one cell of the grid reached by Tab (roving tabindex). */
  focused: boolean;
  ariaLabel: string;
  /** Extra CSS class (for example a spangram highlight). */
  extraClass?: string | undefined;
}

/**
 * One letter of the grid. Its label says the position, the letter and the
 * state in words, so the selection, a found word and a revealed one do not
 * rest on color alone.
 */
export function WordSearchCell({
  row,
  col,
  letter,
  color,
  selected,
  revealed,
  anchor,
  focused,
  ariaLabel,
  extraClass,
}: WordSearchCellProps) {
  const found = color !== undefined;
  const base = cellClass({ selected, color, revealed, anchor });
  return (
    <button
      type="button"
      role="gridcell"
      class={extraClass ? `${base} ${extraClass}` : base}
      data-row={row}
      data-col={col}
      data-found={found ? "true" : undefined}
      tabIndex={focused ? 0 : -1}
      aria-label={ariaLabel}
    >
      <span class="cell-letter">{letter}</span>
    </button>
  );
}
