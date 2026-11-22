import type { GridEvidence } from "./quiz-types";
import {
  ISO_DATE_PATTERN,
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isNonBlankString,
  isNonEmptyString,
  isQid,
  isRecord,
  matchesPattern,
} from "./guards";
import { isHttpsUrl } from "./https-url";

export const STRANDS_SCHEMA_VERSION = "kpop-strands-puzzle-v1" as const;

export interface BilingualText {
  "pt-BR": string;
  en: string;
}

export interface StrandsDimensions {
  rows: number;
  cols: number;
}

/** Zero-based [row, col] as published in the artifact. */
export type StrandsCell = [number, number];

export type SpangramKind = "entity" | "theme";

export interface StrandsWord {
  word: string;
  labels: BilingualText;
  is_spangram: boolean;
  cells: StrandsCell[];
  id?: string;
  canonical_name?: string;
  evidence?: GridEvidence[];
  spangram_kind?: SpangramKind;
}

export interface StrandsPuzzle {
  schema_version: typeof STRANDS_SCHEMA_VERSION;
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  theme: BilingualText;
  theme_description?: BilingualText;
  dimensions: StrandsDimensions;
  grid: string[][];
  words: StrandsWord[];
}

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

const WORD_COMMON = ["word", "labels", "is_spangram", "cells"] as const;
const WORD_ENTITY = ["id", "canonical_name", "evidence"] as const;
const WORD_ALL = [...WORD_COMMON, ...WORD_ENTITY, "spangram_kind"] as const;

const WORD_REGEX = /^[A-Z]{3,}$/;
const SINGLE_LETTER_REGEX = /^[A-Z]$/;
const BILINGUAL_KEYS = ["pt-BR", "en"] as const;
const EVIDENCE_KEYS = ["fact_base_id", "locator", "revision_id", "source_key", "source_url"] as const;
const DIMENSIONS_KEYS = ["rows", "cols"] as const;

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

function areNeighbors(a: StrandsCell, b: StrandsCell): boolean {
  return a[0] !== b[0] || a[1] !== b[1]
    ? Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1
    : false;
}

function spansOppositeSides(cells: StrandsCell[], rows: number, cols: number): boolean {
  const rowValues = new Set(cells.map(([r]) => r));
  const colValues = new Set(cells.map(([, c]) => c));
  const topBottom = rowValues.has(0) && rowValues.has(rows - 1);
  const leftRight = colValues.has(0) && colValues.has(cols - 1);
  return topBottom || leftRight;
}

function findCrossing(paths: StrandsCell[][]): boolean {
  const steps = new Set<string>();
  const key = (a: StrandsCell, b: StrandsCell) => {
    const ordered = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
    return `${ordered[0]![0]},${ordered[0]![1]}|${ordered[1]![0]},${ordered[1]![1]}`;
  };
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      steps.add(key(path[i]!, path[i + 1]!));
    }
  }
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      if (a[0] !== b[0] && a[1] !== b[1]) {
        const other = key([a[0], b[1]], [b[0], a[1]]);
        if (steps.has(other)) return true;
      }
    }
  }
  return false;
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

function isCellPath(
  value: unknown,
  rows: number,
  cols: number,
  expectedLength: number,
): value is StrandsCell[] {
  if (!Array.isArray(value) || value.length !== expectedLength || value.length < 3) return false;
  const seen = new Set<string>();
  let previous: StrandsCell | null = null;
  for (const cell of value) {
    if (!Array.isArray(cell) || cell.length !== 2) return false;
    const [row, col] = cell;
    if (!isIntegerInRange(row, 0, rows - 1) || !isIntegerInRange(col, 0, cols - 1)) return false;
    const id = `${row},${col}`;
    if (seen.has(id)) return false;
    seen.add(id);
    const current: StrandsCell = [row, col];
    if (previous && !areNeighbors(previous, current)) return false;
    previous = current;
  }
  return true;
}

function hasEntityFields(value: Record<string, unknown>): boolean {
  return isQid(value.id)
    && isNonBlankString(value.canonical_name)
    && Array.isArray(value.evidence)
    && value.evidence.length >= 1
    && value.evidence.every(isEvidence);
}

function isValidWordEntry(
  value: unknown,
  rows: number,
  cols: number,
  grid: string[][],
  seenIds: Set<string>,
  seenWords: Set<string>,
): value is StrandsWord {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every((key) => (WORD_ALL as readonly string[]).includes(key))) return false;
  if (!WORD_COMMON.every((key) => Object.hasOwn(value, key))) return false;

  const { word, labels, is_spangram: isSpangram, cells } = value;
  if (!matchesPattern(word, WORD_REGEX) || seenWords.has(word)) return false;
  if (!isBilingualText(labels) || typeof isSpangram !== "boolean") return false;
  if (!isCellPath(cells, rows, cols, word.length)) return false;

  const letters = cells.map(([r, c]) => grid[r]![c]).join("");
  if (letters !== word) return false;

  const normalized = {
    "pt-BR": normalizeWord(labels["pt-BR"]),
    en: normalizeWord(labels.en),
  };
  const entityPresent = WORD_ENTITY.some((key) => Object.hasOwn(value, key));

  if (isSpangram) {
    const kind = value.spangram_kind;
    if (kind !== "entity" && kind !== "theme") return false;
    if (kind === "entity") {
      if (!hasEntityFields(value)) return false;
      if (normalized["pt-BR"] !== word || normalized.en !== word) return false;
    } else {
      if (entityPresent) return false;
      if (normalized["pt-BR"] !== word && normalized.en !== word) return false;
    }
  } else {
    if (Object.hasOwn(value, "spangram_kind")) return false;
    if (normalized["pt-BR"] !== word || normalized.en !== word) return false;
    if (!hasEntityFields(value)) return false;
  }

  if (entityPresent) {
    const id = value.id as string;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
  }

  seenWords.add(word);
  return true;
}

/** Stable key for a word entry: QID when present, otherwise the uppercase word. */
export function strandsWordKey(word: StrandsWord): string {
  return word.id ?? word.word;
}

export function isStrandsPuzzle(value: unknown): value is StrandsPuzzle {
  if (!isRecord(value) || !hasExactKeys(value, ROOT_REQUIRED, ROOT_OPTIONAL)) return false;
  if (value.schema_version !== STRANDS_SCHEMA_VERSION) return false;
  if (!isHash(value.puzzle_id) || !isHash(value.dataset_version)) return false;
  if (!matchesPattern(value.reference_date, ISO_DATE_PATTERN)) return false;
  if (!isBilingualText(value.theme)) return false;
  if (value.theme_description !== undefined && !isBilingualText(value.theme_description)) return false;

  const dims = value.dimensions;
  if (!isRecord(dims) || !hasExactKeys(dims, DIMENSIONS_KEYS)) return false;
  const { rows, cols } = dims;
  if (!isIntegerInRange(rows, 9, 10) || !isIntegerInRange(cols, 9, 10)) return false;
  if (!isLetterGrid(value.grid, rows, cols)) return false;

  const { words, grid } = value;
  if (!Array.isArray(words) || words.length < 6 || words.length > 9) return false;

  const seenIds = new Set<string>();
  const seenWords = new Set<string>();
  const paths: StrandsCell[][] = [];
  let spangramCount = 0;
  let spangramPath: StrandsCell[] | null = null;

  for (const entry of words) {
    if (!isValidWordEntry(entry, rows, cols, grid, seenIds, seenWords)) return false;
    paths.push(entry.cells);
    if (entry.is_spangram) {
      spangramCount += 1;
      spangramPath = entry.cells;
    }
  }

  if (spangramCount !== 1 || !spangramPath) return false;
  if (!spansOppositeSides(spangramPath, rows, cols)) return false;
  if (findCrossing(paths)) return false;

  const owner = new Set<string>();
  for (const path of paths) {
    for (const [r, c] of path) {
      const id = `${r},${c}`;
      if (owner.has(id)) return false;
      owner.add(id);
    }
  }
  if (owner.size !== rows * cols) return false;

  return true;
}
