import { useEffect, useRef } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import { WORD_SEARCH_I18N } from "./types";
import type { Locale } from "../../lib/quiz-types";

interface WordSearchGridProps {
  puzzle: WordSearchPuzzle;
  locale: Locale;
  focusedCell: CellCoord;
  anchorCell: CellCoord | null;
  activePath: CellCoord[];
  foundCellsMap: Map<string, number>;
  onCellPointerDown: (row: number, col: number) => void;
  onCellPointerEnter: (row: number, col: number) => void;
  onCellPointerUp: (row: number, col: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function WordSearchGrid({
  puzzle,
  locale,
  focusedCell,
  anchorCell,
  activePath,
  foundCellsMap,
  onCellPointerDown,
  onCellPointerEnter,
  onCellPointerUp,
  onKeyDown,
}: WordSearchGridProps) {
  const t = WORD_SEARCH_I18N[locale];
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

  return (
    <div
      ref={gridRef}
      class="word-search-grid"
      role="grid"
      aria-label={t.gridLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        "--grid-rows": rows,
        "--grid-cols": cols,
      }}
    >
      {puzzle.grid.map((rowLetters, r) => (
        <div class="word-search-row" role="row" key={`row-${r}`}>
          {rowLetters.map((letter, c) => {
            const key = `${r},${c}`;
            const isSelected = activeCoordSet.has(key);
            const colorIdx = foundCellsMap.get(key);
            const isFound = colorIdx !== undefined;
            const isFocused = focusedCell.row === r && focusedCell.col === c;
            const isAnchor = anchorCell?.row === r && anchorCell?.col === c;

            const classes = [
              "word-search-cell",
              isSelected ? "is-selected" : "",
              isFound ? "is-found" : "",
              isAnchor ? "is-anchor" : "",
              isFound ? `color-${colorIdx}` : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                type="button"
                role="gridcell"
                key={key}
                class={classes}
                data-row={r}
                data-col={c}
                data-found={isFound ? "true" : undefined}
                tabIndex={isFocused ? 0 : -1}
                aria-label={t.cellAria(r, c, letter, isSelected, isFound)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onCellPointerDown(r, c);
                }}
                onPointerEnter={() => onCellPointerEnter(r, c)}
                onPointerUp={() => onCellPointerUp(r, c)}
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
