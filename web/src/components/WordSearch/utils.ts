import type { WordSearchPuzzle } from "../../lib/word-search-types";
import type { CellCoord, GameStatus } from "./types";

export interface StoredProgress {
  foundWordIds: string[];
  elapsedSeconds: number;
  status: GameStatus;
  clueMode: boolean;
}

export function loadStoredProgress(key: string): StoredProgress {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        foundWordIds: Array.isArray(parsed.foundWordIds) ? parsed.foundWordIds : [],
        elapsedSeconds: typeof parsed.elapsedSeconds === "number" ? parsed.elapsedSeconds : 0,
        status: parsed.status === "completed" ? "completed" : "in_progress",
        clueMode: Boolean(parsed.clueMode),
      };
    }
  } catch {}
  return { foundWordIds: [], elapsedSeconds: 0, status: "in_progress", clueMode: false };
}

export function getLinearPath(start: CellCoord, end: CellCoord): CellCoord[] {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);

  const isLinear = dr === 0 || dc === 0 || absR === absC;
  if (!isLinear) return [];

  const length = Math.max(absR, absC) + 1;
  const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
  const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;

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
  elapsedSeconds: number
): string {
  const time = formatTime(elapsedSeconds);
  return `K-pop Word Search ${puzzle.reference_date} ${foundCount}/${totalCount} (${time})`;
}
