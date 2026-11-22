import type { StrandsPuzzle, StrandsWord } from "../../lib/strands-types";
import { strandsWordKey } from "../../lib/strands-types";
import type { CellCoord, TrailVerdict } from "./types";

export function cellKey(cell: CellCoord): string {
  return `${cell.row},${cell.col}`;
}

export function sameCell(a: CellCoord | null | undefined, b: CellCoord | null | undefined): boolean {
  return a != null && b != null && a.row === b.row && a.col === b.col;
}

export function areNeighbors(a: CellCoord, b: CellCoord): boolean {
  if (sameCell(a, b)) return false;
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

export function pathLetters(grid: string[][], path: readonly CellCoord[]): string {
  return path.map((cell) => grid[cell.row]?.[cell.col] ?? "").join("");
}

export function pathFromCells(cells: readonly [number, number][]): CellCoord[] {
  return cells.map(([row, col]) => ({ row, col }));
}

/** True when both paths visit the same cells in the same order. */
export function samePath(a: readonly CellCoord[], b: readonly CellCoord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cell, i) => sameCell(cell, b[i]));
}

/**
 * Extends or undoes a trail. Neighboring unused cells append; revisiting the
 * previous cell pops; any other cell is ignored.
 */
export function extendTrail(path: readonly CellCoord[], next: CellCoord): CellCoord[] {
  if (path.length === 0) return [next];
  const last = path[path.length - 1]!;
  if (sameCell(last, next)) return [...path];
  if (path.length >= 2 && sameCell(path[path.length - 2], next)) {
    return path.slice(0, -1);
  }
  if (path.some((cell) => sameCell(cell, next))) return [...path];
  if (!areNeighbors(last, next)) return [...path];
  return [...path, next];
}

export function wordLabel(word: StrandsWord, locale: "pt-BR" | "en"): string {
  return word.labels[locale] || word.labels.en;
}

/** Scores a confirmed trail against the unpublished solution paths. */
export function judgeTrail(
  puzzle: StrandsPuzzle,
  foundKeys: readonly string[],
  path: readonly CellCoord[],
): TrailVerdict {
  if (path.length < 3) return { kind: "too-short" };
  const letters = pathLetters(puzzle.grid, path);

  for (const word of puzzle.words) {
    const solution = pathFromCells(word.cells);
    if (!samePath(path, solution)) continue;
    const key = strandsWordKey(word);
    if (foundKeys.includes(key)) {
      return { kind: "repeat", wordKey: key, isSpangram: word.is_spangram };
    }
    return { kind: "found", wordKey: key, isSpangram: word.is_spangram };
  }

  return { kind: "miss", letters };
}

export function foundCellColors(
  puzzle: StrandsPuzzle,
  foundKeys: readonly string[],
): Map<string, number> {
  const colors = new Map<string, number>();
  puzzle.words.forEach((word, index) => {
    if (!foundKeys.includes(strandsWordKey(word))) return;
    for (const [row, col] of word.cells) {
      colors.set(cellKey({ row, col }), index % 6);
    }
  });
  return colors;
}

export function spangramCellKeys(puzzle: StrandsPuzzle): Set<string> {
  const spangram = puzzle.words.find((word) => word.is_spangram);
  if (!spangram) return new Set();
  return new Set(spangram.cells.map(([row, col]) => cellKey({ row, col })));
}

export function isSpangramFound(puzzle: StrandsPuzzle, foundKeys: readonly string[]): boolean {
  const spangram = puzzle.words.find((word) => word.is_spangram);
  if (!spangram) return false;
  return foundKeys.includes(strandsWordKey(spangram));
}
