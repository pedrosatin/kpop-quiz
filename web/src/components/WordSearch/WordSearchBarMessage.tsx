import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { Messages } from "../../i18n/catalog";
import type { CellCoord, SelectionCheck } from "./types";

type Copy = Messages["wordSearch"];

interface WordSearchBarMessageProps {
  puzzle: WordSearchPuzzle;
  t: Copy;
  activePath: CellCoord[];
  anchorCell: CellCoord | null;
  lastCheck: SelectionCheck | null;
  foundCount: number;
  wordName: (id: string) => string;
}

function letterAt(puzzle: WordSearchPuzzle, cell: CellCoord): string {
  return puzzle.grid[cell.row]?.[cell.col] ?? "";
}

/** The verdict of a finished selection; "offline" is shown with the new start instead. */
function verdictText(check: Exclude<SelectionCheck, { kind: "offline" }>, t: Copy, wordName: (id: string) => string): string {
  switch (check.kind) {
    case "found":
      return t.foundFeedback(wordName(check.wordId));
    case "repeat":
      return t.repeatFeedback(wordName(check.wordId));
    case "partial":
      return t.partialFeedback(check.letters);
    case "miss":
      return t.missFeedback(check.letters);
    default:
      return t.cancelFeedback;
  }
}

/** Green for a name found, red for letters that are no name; the rest stays neutral. */
export function barTone(lastCheck: SelectionCheck | null): string {
  if (lastCheck?.kind === "found") return " is-correct";
  if (lastCheck?.kind === "miss") return " is-incorrect";
  return "";
}

/**
 * One message at a time, in two reserved lines: the selection in progress,
 * then the start marked by a tap, then the verdict of the last selection,
 * then the instructions. A new key per verdict replaces the paragraph, so
 * the same verdict twice is announced twice.
 */
export function WordSearchBarMessage({ puzzle, t, activePath, anchorCell, lastCheck, foundCount, wordName }: WordSearchBarMessageProps) {
  if (activePath.length > 1) {
    return (
      <p class="word-search-selection">
        <strong>{t.selectionLabel}</strong>{" "}
        <span class="selection-letters">{activePath.map((c) => letterAt(puzzle, c)).join("")}</span>{" "}
        <span class="selection-count">({t.lettersCount(activePath.length)})</span>
      </p>
    );
  }
  if (anchorCell) {
    const letter = letterAt(puzzle, anchorCell);
    const text = lastCheck?.kind === "offline" ? t.offLineFeedback(lastCheck.from, letter) : t.anchorHint(letter);
    return <p key={lastCheck?.n} class="game-actions-title">{text}</p>;
  }
  if (lastCheck && lastCheck.kind !== "offline") {
    return (
      <p key={lastCheck.n} class="game-actions-title">
        {verdictText(lastCheck, t, wordName)}
        {lastCheck.kind === "found" && (
          <span class="visually-hidden"> {t.progressAnnouncement(foundCount, puzzle.words.length)}</span>
        )}
      </p>
    );
  }
  return <p class="game-actions-hint">{t.selectionHint}</p>;
}
