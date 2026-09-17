import type { GridCriterionCategory, IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type CellCoordinates, type GridCellState } from "./types";
import { GridCell } from "./GridCell";

export interface GridBoardProps {
  grid: IntersectionGrid;
  cellStates: Record<string, GridCellState>;
  selectedCell: CellCoordinates | null;
  onSelectCell: (row: number, col: number) => void;
  disabled: boolean;
  locale: Locale;
  messages: Messages;
}

function categoryBadge(category: GridCriterionCategory, messages: Messages): string {
  switch (category) {
    case "formed_on":
      return messages.gridCategoryDebut;
    case "record_label":
      return messages.gridCategoryAgency;
    case "has_member":
      return messages.gridCategoryMembers;
  }
}

export function GridBoard({
  grid,
  cellStates,
  selectedCell,
  onSelectCell,
  disabled,
  locale,
  messages,
}: GridBoardProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.hasAttribute("data-row")) return;

    const row = Number.parseInt(target.getAttribute("data-row") || "0", 10);
    const col = Number.parseInt(target.getAttribute("data-col") || "0", 10);

    let targetRow = row;
    let targetCol = col;

    if (e.key === "ArrowUp" && row > 0) {
      targetRow = row - 1;
      e.preventDefault();
    } else if (e.key === "ArrowDown" && row < 2) {
      targetRow = row + 1;
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && col > 0) {
      targetCol = col - 1;
      e.preventDefault();
    } else if (e.key === "ArrowRight" && col < 2) {
      targetCol = col + 1;
      e.preventDefault();
    } else {
      return;
    }

    const selector = `button[data-row="${targetRow}"][data-col="${targetCol}"]`;
    const nextBtn = target.closest("table")?.querySelector<HTMLButtonElement>(selector);
    nextBtn?.focus();
  };

  return (
    <div class="grid-board-wrapper" onKeyDown={handleKeyDown}>
      <table class="grid-board-table" role="grid" aria-label={messages.gridTitle}>
        <caption class="visually-hidden">{messages.gridIntro}</caption>
        <thead>
          <tr role="row">
            <th scope="col" class="grid-corner-cell">
              <span class="visually-hidden">{messages.gridAxesHeader}</span>
            </th>
            {grid.col_criteria.map((colCrit, colIdx) => (
              <th scope="col" key={colCrit.id} class="grid-col-header" id={`col-header-${colIdx}`}>
                <span class="criterion-category">{categoryBadge(colCrit.category, messages)}</span>
                <span class="criterion-label">{colCrit.label[locale]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.row_criteria.map((rowCrit, rowIdx) => (
            <tr key={rowCrit.id} role="row">
              <th scope="row" class="grid-row-header" id={`row-header-${rowIdx}`}>
                <span class="criterion-category">{categoryBadge(rowCrit.category, messages)}</span>
                <span class="criterion-label">{rowCrit.label[locale]}</span>
              </th>
              {[0, 1, 2].map((colIdx) => {
                const key = cellKey(rowIdx, colIdx);
                const cellState = cellStates[key] || { solved: false, failed: false };
                const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                const colCrit = grid.col_criteria[colIdx]!;

                return (
                  <td key={colIdx} class="grid-cell-wrapper" role="gridcell">
                    <GridCell
                      row={rowIdx}
                      col={colIdx}
                      rowCriterion={rowCrit}
                      colCriterion={colCrit}
                      cellState={cellState}
                      isSelected={isSelected}
                      disabled={disabled}
                      onSelect={() => onSelectCell(rowIdx, colIdx)}
                      locale={locale}
                      messages={messages}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
