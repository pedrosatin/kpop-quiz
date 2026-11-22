import { useEffect, useRef } from "preact/hooks";
import type { CellCoord } from "./types";
import { sameCell } from "./geometry";
import { pointerPosition, releasePointer } from "./pointer";
import { WordSearchCell } from "./word-search-cell";
import { cellKey } from "./word-search-state";

/** Minimum board shape shared by Word Search and Strands. */
export interface LetterGridBoard {
  dimensions: { rows: number; cols: number };
  grid: string[][];
}

export interface WordSearchGridProps {
  board: LetterGridBoard;
  gridLabel: string;
  cellAria: (
    row: number,
    col: number,
    letter: string,
    selected: boolean,
    found: boolean,
    revealed?: boolean,
  ) => string;
  focusedCell: CellCoord;
  anchorCell: CellCoord | null;
  activePath: CellCoord[];
  foundCellsMap: Map<string, number>;
  revealedCells?: Set<string>;
  /** Extra class on a found cell (for example a spangram highlight). */
  cellExtraClass?: (row: number, col: number) => string | undefined;
  /** Positions in cell units; they may fall between cells or off the grid. */
  onCellPointerDown: (row: number, col: number, pointerId: number) => void;
  onCellPointerEnter: (row: number, col: number, pointerId: number) => void;
  onCellPointerUp: (row: number, col: number, pointerId: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Shared letter grid used by Word Search and Strands. Pointer and keyboard
 * semantics stay in the caller; this component only renders cells and routes
 * pointer coordinates in cell units.
 */
export function WordSearchGrid({
  board,
  gridLabel,
  cellAria,
  focusedCell,
  anchorCell,
  activePath,
  foundCellsMap,
  revealedCells,
  cellExtraClass,
  onCellPointerDown,
  onCellPointerEnter,
  onCellPointerUp,
  onKeyDown,
}: WordSearchGridProps) {
  const { rows, cols } = board.dimensions;
  const gridRef = useRef<HTMLDivElement>(null);

  const activeCoordSet = new Set(activePath.map(cellKey));

  useEffect(() => {
    const focusedEl = gridRef.current?.querySelector<HTMLElement>(
      `[data-row="${focusedCell.row}"][data-col="${focusedCell.col}"]`
    );
    if (focusedEl && document.activeElement && gridRef.current?.contains(document.activeElement)) {
      focusedEl.focus();
    }
  }, [focusedCell]);

  const positionOf = (e: PointerEvent) => pointerPosition(gridRef.current, board.dimensions, e);

  const handleGridPointerDown = (e: PointerEvent) => {
    const position = positionOf(e);
    if (!position) return;
    e.preventDefault();
    releasePointer(e);
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
      aria-label={gridLabel}
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
      {board.grid.map((rowLetters, r) => (
        <div class="word-search-row" role="row" key={`row-${r}`}>
          {rowLetters.map((letter, c) => {
            const here = { row: r, col: c };
            const key = cellKey(here);
            const color = foundCellsMap.get(key);
            const extra = cellExtraClass?.(r, c);
            return (
              <WordSearchCell
                key={key}
                row={r}
                col={c}
                letter={letter}
                color={color}
                selected={activeCoordSet.has(key)}
                revealed={color === undefined && (revealedCells?.has(key) ?? false)}
                anchor={sameCell(anchorCell, here)}
                focused={sameCell(focusedCell, here)}
                ariaLabel={cellAria(
                  r,
                  c,
                  letter,
                  activeCoordSet.has(key),
                  color !== undefined,
                  color === undefined && (revealedCells?.has(key) ?? false),
                )}
                extraClass={extra}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
