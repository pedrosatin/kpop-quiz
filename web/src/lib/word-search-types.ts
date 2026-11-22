import type { GridEvidence } from "./quiz-types";
import {
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isIsoDate,
  isNonBlankString,
  isNonEmptyString,
  isQid,
  isRecord,
  matchesPattern,
} from "./guards";
import { isHttpsUrl } from "./https-url";

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

const WORD_REGEX = /^[A-Z]{3,16}$/;
const SINGLE_LETTER_REGEX = /^[A-Z]$/;

const ROOT_REQUIRED = [
  "schema_version",
  "puzzle_id",
  "dataset_version",
  "reference_date",
  "theme",
  "dimensions",
  "grid",
  "words",
] as const;

const ROOT_OPTIONAL = ["theme_description"] as const;
const BILINGUAL_KEYS = ["pt-BR", "en"] as const;
const DIMENSIONS_KEYS = ["rows", "cols"] as const;
const EVIDENCE_KEYS = ["fact_base_id", "locator", "revision_id", "source_key", "source_url"] as const;
const WORD_REQUIRED = [
  "id",
  "word",
  "canonical_name",
  "labels",
  "start_row",
  "start_col",
  "end_row",
  "end_col",
  "evidence",
] as const;
const WORD_OPTIONAL = ["clue"] as const;

function normalizeWord(name: string): string {
  return name.normalize("NFKD").toUpperCase().replace(/[^A-Z]/g, "");
}

function isBilingualText(value: unknown): value is BilingualText {
  return isRecord(value)
    && hasExactKeys(value, BILINGUAL_KEYS)
    && isNonBlankString(value["pt-BR"])
    && isNonBlankString(value.en);
}

function isEvidence(value: unknown): value is GridEvidence {
  return isRecord(value)
    && hasExactKeys(value, EVIDENCE_KEYS)
    && isNonEmptyString(value.fact_base_id)
    && isNonEmptyString(value.locator)
    && isIntegerInRange(value.revision_id, 1)
    && isNonEmptyString(value.source_key)
    && isHttpsUrl(value.source_url);
}

function hasWordFields(value: Record<string, unknown>): boolean {
  if (!hasExactKeys(value, WORD_REQUIRED, WORD_OPTIONAL)) return false;
  const { id, word, canonical_name, labels, clue, evidence } = value;
  return isQid(id)
    && matchesPattern(word, WORD_REGEX)
    && isNonBlankString(canonical_name)
    && isBilingualText(labels)
    && normalizeWord(labels["pt-BR"]) === word
    && normalizeWord(labels.en) === word
    && (clue === undefined || isBilingualText(clue))
    && Array.isArray(evidence) && evidence.length >= 1 && evidence.every(isEvidence);
}

function spellsWordOnGrid(
  word: string,
  start: { row: number; col: number },
  end: { row: number; col: number },
  grid: string[][],
): boolean {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  const isLinear =
    (dr === 0 && dc !== 0) ||
    (dc === 0 && dr !== 0) ||
    Math.abs(dr) === Math.abs(dc);
  if (!isLinear) return false;

  const length = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  if (length !== word.length) return false;

  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  for (let i = 0; i < length; i++) {
    if (grid[start.row + i * stepR]?.[start.col + i * stepC] !== word[i]) return false;
  }
  return true;
}

function isValidWordEntry(
  value: unknown,
  rows: number,
  cols: number,
  grid: string[][]
): value is WordSearchWord {
  if (!isRecord(value) || !hasWordFields(value)) return false;
  const { start_row, start_col, end_row, end_col } = value;
  if (
    !isIntegerInRange(start_row, 0, rows - 1)
    || !isIntegerInRange(start_col, 0, cols - 1)
    || !isIntegerInRange(end_row, 0, rows - 1)
    || !isIntegerInRange(end_col, 0, cols - 1)
  ) return false;
  return spellsWordOnGrid(
    value.word as string,
    { row: start_row, col: start_col },
    { row: end_row, col: end_col },
    grid,
  );
}

function isLetterGrid(value: unknown, rows: number, cols: number): value is string[][] {
  if (!Array.isArray(value) || value.length !== rows) return false;
  for (let r = 0; r < rows; r++) {
    const row = value[r];
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (let c = 0; c < cols; c++) {
      if (!matchesPattern(row[c], SINGLE_LETTER_REGEX)) return false;
    }
  }
  return true;
}

function hasPuzzleHeader(value: Record<string, unknown>): boolean {
  return value.schema_version === "kpop-word-search-puzzle-v1"
    && isHash(value.puzzle_id)
    && isHash(value.dataset_version)
    && isIsoDate(value.reference_date)
    && isBilingualText(value.theme)
    && (value.theme_description === undefined || isBilingualText(value.theme_description));
}

export function isWordSearchPuzzle(value: unknown): value is WordSearchPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, ROOT_REQUIRED, ROOT_OPTIONAL) || !hasPuzzleHeader(value)) {
    return false;
  }

  const dims = value.dimensions;
  if (!isRecord(dims) || !hasExactKeys(dims, DIMENSIONS_KEYS)) return false;
  const { rows, cols } = dims;
  if (!isIntegerInRange(rows, 8, 16) || !isIntegerInRange(cols, 8, 16)) return false;

  const { grid, words } = value;
  if (!isLetterGrid(grid, rows, cols)) return false;
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
