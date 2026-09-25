import { useEffect, useRef } from "preact/hooks";
import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import { getMessages } from "../../i18n/catalog";
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

  // Touch input keeps sending move and up events to the cell where the finger
  // went down, so the cell under the pointer comes from its coordinates.
  const cellAtPoint = (x: number, y: number): CellCoord | null => {
    const cellBtn = document.elementFromPoint?.(x, y)?.closest<HTMLElement>(".word-search-cell");
    if (!cellBtn || !gridRef.current?.contains(cellBtn)) return null;
    const row = parseInt(cellBtn.getAttribute("data-row") ?? "-1", 10);
    const col = parseInt(cellBtn.getAttribute("data-col") ?? "-1", 10);
    return row >= 0 && col >= 0 ? { row, col } : null;
  };

  const handleGridPointerMove = (e: PointerEvent) => {
    if (e.buttons === 0 && !anchorCell) return;
    const cell = cellAtPoint(e.clientX, e.clientY);
    if (cell) {
      onCellPointerEnter(cell.row, cell.col);
    }
  };

  return (
    <div
      ref={gridRef}
      class="word-search-grid"
      role="grid"
      aria-label={t.gridLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={handleGridPointerMove}
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
                  // Touch captures the pointer on the element under the finger,
                  // often the letter span, so release it wherever it landed.
                  for (const el of [e.target, e.currentTarget] as Element[]) {
                    try {
                      if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
                    } catch {}
                  }
                  onCellPointerDown(r, c);
                }}
                onPointerEnter={() => onCellPointerEnter(r, c)}
                onPointerUp={(e) => {
                  // A touch or pen lifted outside the grid is left to the window
                  // listener in the hook, which ends the drag on the last cell crossed.
                  const captured = e.pointerType === "touch" || e.pointerType === "pen";
                  const released = cellAtPoint(e.clientX, e.clientY) ?? (captured ? null : { row: r, col: c });
                  if (released) onCellPointerUp(released.row, released.col);
                }}
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
