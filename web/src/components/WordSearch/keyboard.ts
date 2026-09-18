import type { CellCoord } from "./types";
import type { WordSearchDimensions } from "../../lib/word-search-types";

export interface KeyboardNavContext {
  focusedCell: CellCoord;
  anchorCell: CellCoord | null;
  dimensions: WordSearchDimensions;
  setFocusedCell: (cell: CellCoord) => void;
  setAnchorCell: (cell: CellCoord | null) => void;
  setCurrentHoverCell: (cell: CellCoord | null) => void;
  checkSelection: (start: CellCoord, end: CellCoord) => boolean;
}

export function handleWordSearchKeyDown(e: KeyboardEvent, ctx: KeyboardNavContext): void {
  const {
    focusedCell,
    anchorCell,
    dimensions,
    setFocusedCell,
    setAnchorCell,
    setCurrentHoverCell,
    checkSelection,
  } = ctx;

  const { rows, cols } = dimensions;
  let newRow = focusedCell.row;
  let newCol = focusedCell.col;

  if (e.key === "ArrowUp") newRow = Math.max(0, newRow - 1);
  else if (e.key === "ArrowDown") newRow = Math.min(rows - 1, newRow + 1);
  else if (e.key === "ArrowLeft") newCol = Math.max(0, newCol - 1);
  else if (e.key === "ArrowRight") newCol = Math.min(cols - 1, newCol + 1);
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (!anchorCell) {
      setAnchorCell({ row: newRow, col: newCol });
      setCurrentHoverCell({ row: newRow, col: newCol });
    } else {
      checkSelection(anchorCell, { row: newRow, col: newCol });
      setAnchorCell(null);
      setCurrentHoverCell(null);
    }
    return;
  } else if (e.key === "Escape") {
    setAnchorCell(null);
    setCurrentHoverCell(null);
    return;
  } else {
    return;
  }

  e.preventDefault();
  setFocusedCell({ row: newRow, col: newCol });
  if (anchorCell) {
    setCurrentHoverCell({ row: newRow, col: newCol });
  }
}
