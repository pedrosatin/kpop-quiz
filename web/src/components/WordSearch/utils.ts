import type { WordSearchPuzzle, WordSearchWord } from "../../lib/word-search-types";
import type { CellCoord, GameStatus } from "./types";
import type { Locale } from "../../lib/quiz-types";

export interface StoredProgress {
  foundWordIds: string[];
  elapsedSeconds: number;
  status: GameStatus;
  easyMode: boolean;
  clueMode?: boolean;
}

export function loadStoredProgress(key: string): StoredProgress {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const isEasy = Boolean(parsed.easyMode ?? parsed.clueMode);
      return {
        foundWordIds: Array.isArray(parsed.foundWordIds) ? parsed.foundWordIds : [],
        elapsedSeconds: typeof parsed.elapsedSeconds === "number" ? parsed.elapsedSeconds : 0,
        status: parsed.status === "completed" ? "completed" : "in_progress",
        easyMode: isEasy,
        clueMode: isEasy,
      };
    }
  } catch {}
  return { foundWordIds: [], elapsedSeconds: 0, status: "in_progress", easyMode: false, clueMode: false };
}

export function normalizeWord(name: string): string {
  return name
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function isWordMatch(
  word: WordSearchWord,
  start: CellCoord,
  end: CellCoord,
  letters: string,
  revLetters: string,
  locale: Locale
): boolean {
  const fullWordPath = getLinearPath(
    { row: word.start_row, col: word.start_col },
    { row: word.end_row, col: word.end_col }
  );

  const candidateSet = new Set<string>();
  candidateSet.add(word.word);

  const rawNames = [
    word.canonical_name,
    word.labels?.[locale],
    word.labels?.["pt-BR"],
    word.labels?.["en"],
  ].filter(Boolean) as string[];

  for (const name of rawNames) {
    const norm = normalizeWord(name);
    if (norm.length >= 3) {
      candidateSet.add(norm);
    }
    const tokens = name.trim().split(/[\s-]+/);
    if (tokens.length > 1) {
      const lastToken = tokens[tokens.length - 1];
      if (lastToken) {
        const lastTokenNorm = normalizeWord(lastToken);
        if (lastTokenNorm.length >= 3) {
          candidateSet.add(lastTokenNorm);
        }
      }
      const afterFirst = tokens.slice(1).join("");
      const afterFirstNorm = normalizeWord(afterFirst);
      if (afterFirstNorm.length >= 3) {
        candidateSet.add(afterFirstNorm);
      }
    }
  }

  for (const cand of candidateSet) {
    if (cand.length < 3 || cand.length > word.word.length) continue;

    // Direct full-word match
    if (word.word === cand) {
      const fwd =
        word.start_row === start.row &&
        word.start_col === start.col &&
        word.end_row === end.row &&
        word.end_col === end.col &&
        letters === cand;
      const rev =
        word.start_row === end.row &&
        word.start_col === end.col &&
        word.end_row === start.row &&
        word.end_col === start.col &&
        revLetters === cand;
      if (fwd || rev) return true;
    }

    // Subsegment match inside word.word
    let searchFrom = 0;
    while (searchFrom <= word.word.length - cand.length) {
      const idx = word.word.indexOf(cand, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 1;

      const subStart = fullWordPath[idx];
      const subEnd = fullWordPath[idx + cand.length - 1];
      if (!subStart || !subEnd) continue;

      const fwd =
        start.row === subStart.row &&
        start.col === subStart.col &&
        end.row === subEnd.row &&
        end.col === subEnd.col &&
        letters === cand;
      const rev =
        start.row === subEnd.row &&
        start.col === subEnd.col &&
        end.row === subStart.row &&
        end.col === subStart.col &&
        revLetters === cand;
      if (fwd || rev) return true;
    }
  }

  return false;
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
