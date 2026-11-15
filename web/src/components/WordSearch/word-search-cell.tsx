import type { Messages } from "../../i18n/catalog";
import { cellClass } from "./pointer";

interface WordSearchCellProps {
  t: Messages["wordSearch"];
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
}

/**
 * One letter of the grid. Its label says the position, the letter and the
 * state in words, so the selection, a found word and a revealed one do not
 * rest on color alone.
 */
export function WordSearchCell({ t, row, col, letter, color, selected, revealed, anchor, focused }: WordSearchCellProps) {
  const found = color !== undefined;
  return (
    <button
      type="button"
      role="gridcell"
      class={cellClass({ selected, color, revealed, anchor })}
      data-row={row}
      data-col={col}
      data-found={found ? "true" : undefined}
      tabIndex={focused ? 0 : -1}
      aria-label={t.cellAria(row, col, letter, selected, found, revealed)}
    >
      <span class="cell-letter">{letter}</span>
    </button>
  );
}
