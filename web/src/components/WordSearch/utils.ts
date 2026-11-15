import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord } from "./types";
import type { Locale } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import { seoShareUrl } from "../../lib/seo-routes";
import { withShareUrl } from "../Results/share-text";

// The save moved to word-search-save; older imports still find it here.
export { loadStoredProgress, type StoredProgress } from "./word-search-save";

export function getLinearPath(start: CellCoord, end: CellCoord): CellCoord[] {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);

  const isLinear = dr === 0 || dc === 0 || absR === absC;
  if (!isLinear) return [];

  const length = Math.max(absR, absC) + 1;
  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);

  const path: CellCoord[] = [];
  for (let i = 0; i < length; i++) {
    path.push({
      row: start.row + i * stepR,
      col: start.col + i * stepC,
    });
  }
  return path;
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function generateWordSearchShareSummary(
  puzzle: WordSearchPuzzle,
  foundCount: number,
  totalCount: number,
  elapsedSeconds: number,
  locale: Locale
): string {
  const time = formatTime(elapsedSeconds);
  const messages = getMessages(locale);
  return withShareUrl(
    messages.wordSearchShareHeader(puzzle.reference_date, foundCount, totalCount, time),
    seoShareUrl("wordSearch", locale)
  );
}
