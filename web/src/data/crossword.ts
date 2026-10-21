import type { Locale } from "../lib/quiz-types";

export type CrosswordDirection = "across" | "down";

export interface CrosswordSource {
  url: string;
  locator: string;
  snippet: string;
  statement_id: string;
  predicate: string;
  value: string;
}

export interface CrosswordEntry {
  qid: string;
  canonical_name: string;
  aliases: string[];
  answer: string;
  row: number;
  col: number;
  direction: CrosswordDirection;
  number: number;
  clue: Record<Locale, string>;
  matching_qids: string[];
  sources: CrosswordSource[];
}

export interface CrosswordCell {
  row: number;
  col: number;
  answer: string;
}

export interface CrosswordPuzzle {
  schema_version: string;
  mode: string;
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  rows: number;
  cols: number;
  vocabulary: string[];
  audited_group_count: number;
  entries: CrosswordEntry[];
  cells: CrosswordCell[];
}

export class CrosswordArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Crossword artifact ${kind}`);
  }
}

// Constants and field sets of schemas/crossword-pilot-v1.json, the same ones
// kpop_scraping/crossword_cli.py validates; crossword.test.ts pins both.
export const CROSSWORD_SCHEMA_VERSION = "crossword-pilot-v1";
export const CROSSWORD_MODE = "pilot";
export const CROSSWORD_PUZZLE_ID = "crossword-audited-01";
export const CROSSWORD_MAX_SIDE = 9;
export const CROSSWORD_MIN_ENTRIES = 3;
export const CROSSWORD_MAX_ENTRIES = 5;
export const CROSSWORD_ROOT_KEYS = ["schema_version", "mode", "puzzle_id", "dataset_version", "reference_date", "rows", "cols", "vocabulary", "audited_group_count", "entries", "cells"] as const;
export const CROSSWORD_ENTRY_KEYS = ["qid", "canonical_name", "aliases", "answer", "row", "col", "direction", "number", "clue", "matching_qids", "sources"] as const;
export const CROSSWORD_SOURCE_KEYS = ["url", "locator", "snippet", "statement_id", "predicate", "value"] as const;
export const CROSSWORD_CELL_KEYS = ["row", "col", "answer"] as const;

/** Data file of the audited board, a fixed match (no daily cadence yet). */
export const CROSSWORD_DATA_FILE = "crossword-pilot.json";

/** Upper case, no accents, spaces or punctuation; digits stay. Same as normalize() in Python. */
export function normalizeCrosswordText(value: string): string {
  return value.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** Key of the i-th letter of an entry. */
export function entryCellKey(entry: CrosswordEntry, index: number): string {
  return cellKey(
    entry.row + (entry.direction === "down" ? index : 0),
    entry.col + (entry.direction === "across" ? index : 0),
  );
}

export function entryCellKeys(entry: CrosswordEntry): string[] {
  return Array.from({ length: entry.answer.length }, (_, i) => entryCellKey(entry, i));
}

function hasKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

// Python identity: sorted keys, compact separators, raw UTF-8 (canonical_json).
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export async function crosswordChecksum(puzzle: Omit<CrosswordPuzzle, "dataset_version"> | CrosswordPuzzle): Promise<string> {
  const { dataset_version: _ignored, ...content } = puzzle as CrosswordPuzzle;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(content))));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const WIKIPEDIA_URL = /^https:\/\/([a-z]{2,3}(?:-[a-z]+)?)\.wikipedia\.org\/w\/index\.php\?curid=([1-9][0-9]*)&oldid=([1-9][0-9]*)$/;
const WIKIPEDIA_LOCATOR = /^wikipedia:([a-z]{2,3}(?:-[a-z]+)?):pageid=([1-9][0-9]*):revid=([1-9][0-9]*)#(?:extract|wikitext)\[(\d+):(\d+)\]$/;

function invalid(): never {
  throw new CrosswordArtifactError("invalid");
}

function isSide(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= CROSSWORD_MAX_SIDE;
}

/**
 * Domain rules of crossword-pilot-v1, mirroring validate() in
 * kpop_scraping/crossword_cli.py: identity and checksum, board bounds,
 * numbering, crossings, connectivity, alias collisions, cited evidence and
 * the cell list derived from the entries. Throws CrosswordArtifactError.
 */
export async function validateCrosswordPuzzle(value: unknown): Promise<CrosswordPuzzle> {
  if (!hasKeys(value, CROSSWORD_ROOT_KEYS)) invalid();
  const p = value as unknown as CrosswordPuzzle;
  if (p.schema_version !== CROSSWORD_SCHEMA_VERSION || p.mode !== CROSSWORD_MODE || p.puzzle_id !== CROSSWORD_PUZZLE_ID) invalid();
  if (typeof p.dataset_version !== "string" || !/^[a-f0-9]{64}$/.test(p.dataset_version)) invalid();
  if (typeof p.reference_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.reference_date)) invalid();
  const parsedDate = new Date(`${p.reference_date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== p.reference_date) invalid();
  if ((await crosswordChecksum(p)) !== p.dataset_version) invalid();
  if (!isSide(p.rows) || !isSide(p.cols)) invalid();
  if (!Array.isArray(p.entries) || p.entries.length < CROSSWORD_MIN_ENTRIES || p.entries.length > CROSSWORD_MAX_ENTRIES) invalid();
  if (!Number.isInteger(p.audited_group_count) || p.audited_group_count < p.entries.length) invalid();
  if (!Array.isArray(p.cells) || !Array.isArray(p.vocabulary)) invalid();
  if (!p.cells.every((c) => hasKeys(c, CROSSWORD_CELL_KEYS))) invalid();

  const expected = new Map<string, string>();
  const owners = new Map<string, CrosswordEntry[]>();
  const names = new Map<string, string>();
  const ids = new Set<string>();
  for (const e of p.entries) {
    if (!hasKeys(e, CROSSWORD_ENTRY_KEYS) || !hasKeys(e.clue, ["pt-BR", "en"])) invalid();
    if (!Array.isArray(e.aliases) || !Array.isArray(e.sources) || !Array.isArray(e.matching_qids)) invalid();
    if (typeof e.qid !== "string" || !/^Q[1-9][0-9]*$/.test(e.qid) || ids.has(e.qid)) invalid();
    ids.add(e.qid);
    if (typeof e.canonical_name !== "string") invalid();
    const word = normalizeCrosswordText(e.canonical_name);
    if (!word || word !== e.answer) invalid();
    if (e.direction !== "across" && e.direction !== "down") invalid();
    if (!Number.isInteger(e.row) || !Number.isInteger(e.col)) invalid();
    for (const name of [e.canonical_name, ...e.aliases]) {
      if (typeof name !== "string") invalid();
      const alias = normalizeCrosswordText(name);
      if (alias && names.has(alias) && names.get(alias) !== e.qid) invalid();
      names.set(alias, e.qid);
    }
    if (!(["pt-BR", "en"] as const).every((l) => typeof e.clue[l] === "string" && e.clue[l].trim())) invalid();
    if (!e.sources.length) invalid();
    for (const source of e.sources) {
      if (!hasKeys(source, CROSSWORD_SOURCE_KEYS)) invalid();
      if (![source.predicate, source.value].every((s) => typeof s === "string" && s)) invalid();
      const url = typeof source.url === "string" ? source.url.match(WIKIPEDIA_URL) : null;
      const locator = typeof source.locator === "string" ? source.locator.match(WIKIPEDIA_LOCATOR) : null;
      if (!url || !locator || url.slice(1, 4).join(":") !== locator.slice(1, 4).join(":")) invalid();
      if (Number(locator[4]) >= Number(locator[5])) invalid();
      if (typeof source.snippet !== "string" || !source.snippet) invalid();
      if (typeof source.statement_id !== "string" || !source.statement_id.startsWith(`${e.qid}$`)) invalid();
    }
    for (let i = 0; i < word.length; i++) {
      const key = entryCellKey(e, i);
      const [r, c] = key.split(":").map(Number) as [number, number];
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) invalid();
      if (expected.has(key) && (expected.get(key) !== word[i] || owners.get(key)!.some((o) => o.direction === e.direction))) invalid();
      expected.set(key, word[i]!);
      owners.set(key, [...(owners.get(key) ?? []), e]);
    }
  }

  const starts = [...new Set(p.entries.map((e) => cellKey(e.row, e.col)))].sort((a, b) => {
    const [ar, ac] = a.split(":").map(Number) as [number, number];
    const [br, bc] = b.split(":").map(Number) as [number, number];
    return ar - br || ac - bc;
  });
  if (p.entries.some((e) => e.number !== starts.indexOf(cellKey(e.row, e.col)) + 1)) invalid();

  const reached = new Set([p.entries[0]!.qid]);
  for (const _ of p.entries) {
    for (const group of owners.values()) {
      if (group.some((e) => reached.has(e.qid))) group.forEach((e) => reached.add(e.qid));
    }
  }
  if (reached.size !== ids.size) invalid();
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(p.vocabulary)) invalid();
  if (p.entries.some((e) => e.matching_qids.length !== 1 || e.matching_qids[0] !== e.qid)) invalid();
  const derived = [...expected.entries()]
    .map(([key, answer]) => {
      const [row, col] = key.split(":").map(Number) as [number, number];
      return { row, col, answer };
    })
    .sort((a, b) => a.row - b.row || a.col - b.col);
  if (JSON.stringify(derived) !== JSON.stringify(p.cells.map(({ row, col, answer }) => ({ row, col, answer })))) invalid();
  return p;
}

function dataUrl(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${CROSSWORD_DATA_FILE}`;
}

/** Loads and validates the audited board. A 404 is "missing", anything else "invalid". */
export async function loadCrosswordPuzzle(baseUrl?: string, signal?: AbortSignal): Promise<CrosswordPuzzle> {
  let response: Response;
  try {
    response = await fetch(dataUrl(baseUrl ?? import.meta.env.BASE_URL), signal ? { signal } : undefined);
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "AbortError") throw error;
    throw new CrosswordArtifactError("invalid");
  }
  if (response.status === 404) throw new CrosswordArtifactError("missing");
  if (!response.ok) throw new CrosswordArtifactError("invalid");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CrosswordArtifactError("invalid");
  }
  return validateCrosswordPuzzle(payload);
}
