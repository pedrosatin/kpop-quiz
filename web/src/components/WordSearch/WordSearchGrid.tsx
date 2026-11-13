import { useEffect, useRef } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import { sameCell } from "./geometry";
import { cellClass, pointerPosition, releasePointer } from "./pointer";
import { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchGridProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  focusedCell: CellCoord;
  anchorCell: CellCoord | null;
  activePath: CellCoord[];
  foundCellsMap: Map<string, number>;
  revealedCells?: Set<string>;
  /** Positions in cell units; they may fall between cells or off the grid. */
  onCellPointerDown: (row: number, col: number, pointerId: number) => void;
  onCellPointerEnter: (row: number, col: number, pointerId: number) => void;
  onCellPointerUp: (row: number, col: number, pointerId: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function WordSearchGrid({
  puzzle,
  locale,
  focusedCell,
  anchorCell,
  activePath,
  foundCellsMap,
  revealedCells,
  onCellPointerDown,
  onCellPointerEnter,
  onCellPointerUp,
  onKeyDown,
}: WordSearchGridProps) {
  const t = getMessages(locale).wordSearch;
  const { rows, cols } = puzzle.dimensions;
  const gridRef = useRef<HTMLDivElement>(null);

  const activeCoordSet = new Set(activePath.map((c) => `${c.row},${c.col}`));

  useEffect(() => {
    const focusedEl = gridRef.current?.querySelector<HTMLElement>(
      `[data-row="${focusedCell.row}"][data-col="${focusedCell.col}"]`
    );
    if (focusedEl && document.activeElement && gridRef.current?.contains(document.activeElement)) {
      focusedEl.focus();
    }
  }, [focusedCell]);

  const positionOf = (e: PointerEvent) => pointerPosition(gridRef.current, puzzle.dimensions, e);

  const handleGridPointerDown = (e: PointerEvent) => {
    const position = positionOf(e);
    if (!position) return;
    e.preventDefault();
    releasePointer(e);
    // The raw position, so a press tells a tap from a drag by how far it went.
    onCellPointerDown(position.row, position.col, e.pointerId);
  };

  const handleGridPointerMove = (e: PointerEvent) => {
    if (e.buttons === 0 && !anchorCell) return;
    const position = positionOf(e);
    if (position) onCellPointerEnter(position.row, position.col, e.pointerId);
  };

  const handleGridPointerUp = (e: PointerEvent) => {
    const position = positionOf(e);
    if (position) onCellPointerUp(position.row, position.col, e.pointerId);
  };

  return (
    <div
      ref={gridRef}
      class="word-search-grid"
      role="grid"
      aria-label={t.gridLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={handleGridPointerDown}
      onPointerMove={handleGridPointerMove}
      onPointerUp={handleGridPointerUp}
      style={{
        "--grid-rows": rows,
        "--grid-cols": cols,
      }}
    >
      {puzzle.grid.map((rowLetters, r) => (
        <div class="word-search-row" role="row" key={`row-${r}`}>
          {rowLetters.map((letter, c) => {
            const key = `${r},${c}`;
            const here = { row: r, col: c };
            const color = foundCellsMap.get(key);
            const isSelected = activeCoordSet.has(key);
            const isRevealed = color === undefined && (revealedCells?.has(key) ?? false);
            const classes = cellClass({ selected: isSelected, color, revealed: isRevealed, anchor: sameCell(anchorCell, here) });

            return (
              <button
                type="button"
                role="gridcell"
                key={key}
                class={classes}
                data-row={r}
                data-col={c}
                data-found={color !== undefined ? "true" : undefined}
                tabIndex={sameCell(focusedCell, here) ? 0 : -1}
                aria-label={t.cellAria(r, c, letter, isSelected, color !== undefined, isRevealed)}
              >
                <span class="cell-letter">{letter}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
