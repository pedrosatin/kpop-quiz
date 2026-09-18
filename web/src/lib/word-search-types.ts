import type { GridEvidence } from "./quiz-types";

export interface BilingualText {
  "pt-BR": string;
  en: string;
}

export interface WordSearchDimensions {
  rows: number;
  cols: number;
}

export interface WordSearchWord {
  id: string;
  word: string;
  canonical_name: string;
  labels: BilingualText;
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
  clue?: BilingualText;
  evidence: GridEvidence[];
}

export interface WordSearchPuzzle {
  schema_version: "kpop-word-search-puzzle-v1";
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  theme: BilingualText;
  theme_description?: BilingualText;
  dimensions: WordSearchDimensions;
  grid: string[][];
  words: WordSearchWord[];
}

const HASH_REGEX = /^[0-9a-f]{64}$/;
const QID_REGEX = /^Q[1-9][0-9]*$/;
const WORD_REGEX = /^[A-Z]{3,16}$/;
const SINGLE_LETTER_REGEX = /^[A-Z]$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBilingualText(value: unknown): value is BilingualText {
  if (!isRecord(value)) return false;
  return (
    typeof value["pt-BR"] === "string" &&
    value["pt-BR"].trim().length > 0 &&
    typeof value.en === "string" &&
    value.en.trim().length > 0
  );
}

function isEvidence(value: unknown): value is GridEvidence {
  if (!isRecord(value)) return false;
  return (
    typeof value.fact_base_id === "string" &&
    value.fact_base_id.length > 0 &&
    typeof value.locator === "string" &&
    value.locator.length > 0 &&
    typeof value.revision_id === "number" &&
    Number.isInteger(value.revision_id) &&
    value.revision_id >= 1 &&
    typeof value.source_key === "string" &&
    value.source_key.length > 0 &&
    typeof value.source_url === "string" &&
    value.source_url.startsWith("https://")
  );
}

function isValidWordEntry(
  value: unknown,
  rows: number,
  cols: number,
  grid: string[][]
): value is WordSearchWord {
  if (!isRecord(value)) return false;
  const {
    id,
    word,
    canonical_name,
    labels,
    start_row,
    start_col,
    end_row,
    end_col,
    clue,
    evidence,
  } = value;

  if (typeof id !== "string" || !QID_REGEX.test(id)) return false;
  if (typeof word !== "string" || !WORD_REGEX.test(word)) return false;
  if (typeof canonical_name !== "string" || canonical_name.trim().length === 0) return false;
  if (!isBilingualText(labels)) return false;
  if (clue !== undefined && !isBilingualText(clue)) return false;
  if (!Array.isArray(evidence) || evidence.length < 1 || !evidence.every(isEvidence)) return false;

  if (
    typeof start_row !== "number" ||
    !Number.isInteger(start_row) ||
    start_row < 0 ||
    start_row >= rows
  ) return false;
  if (
    typeof start_col !== "number" ||
    !Number.isInteger(start_col) ||
    start_col < 0 ||
    start_col >= cols
  ) return false;
  if (
    typeof end_row !== "number" ||
    !Number.isInteger(end_row) ||
    end_row < 0 ||
    end_row >= rows
  ) return false;
  if (
    typeof end_col !== "number" ||
    !Number.isInteger(end_col) ||
    end_col < 0 ||
    end_col >= cols
  ) return false;

  const dr = end_row - start_row;
  const dc = end_col - start_col;
  const isLinear =
    (dr === 0 && dc !== 0) ||
    (dc === 0 && dr !== 0) ||
    Math.abs(dr) === Math.abs(dc);
  if (!isLinear) return false;

  const length = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  if (length !== word.length) return false;

  const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
  const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;

  for (let i = 0; i < length; i++) {
    const r = start_row + i * stepR;
    const c = start_col + i * stepC;
    if (grid[r]?.[c] !== word[i]) {
      return false;
    }
  }

  return true;
}

export function isWordSearchPuzzle(value: unknown): value is WordSearchPuzzle {
  if (!isRecord(value)) return false;
  if (value.schema_version !== "kpop-word-search-puzzle-v1") return false;
  if (typeof value.puzzle_id !== "string" || !HASH_REGEX.test(value.puzzle_id)) return false;
  if (typeof value.dataset_version !== "string" || !HASH_REGEX.test(value.dataset_version)) return false;
  if (typeof value.reference_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.reference_date)) return false;
  if (!isBilingualText(value.theme)) return false;
  if (value.theme_description !== undefined && !isBilingualText(value.theme_description)) return false;

  const dims = value.dimensions;
  if (!isRecord(dims)) return false;
  const { rows, cols } = dims;
  if (
    typeof rows !== "number" ||
    !Number.isInteger(rows) ||
    rows < 8 ||
    rows > 16 ||
    typeof cols !== "number" ||
    !Number.isInteger(cols) ||
    cols < 8 ||
    cols > 16
  ) {
    return false;
  }

  const { grid, words } = value;
  if (!Array.isArray(grid) || grid.length !== rows) return false;
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (let c = 0; c < cols; c++) {
      if (typeof row[c] !== "string" || !SINGLE_LETTER_REGEX.test(row[c])) {
        return false;
      }
    }
  }

  if (!Array.isArray(words) || words.length < 3 || words.length > 20) return false;

  const seenIds = new Set<string>();
  const seenWords = new Set<string>();
  for (const entry of words) {
    if (!isValidWordEntry(entry, rows, cols, grid)) return false;
    if (seenIds.has(entry.id)) return false;
    if (seenWords.has(entry.word)) return false;
    seenIds.add(entry.id);
    seenWords.add(entry.word);
  }

  return true;
}
