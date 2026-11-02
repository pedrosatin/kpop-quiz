import type { Locale } from "../lib/quiz-types";
import { dailyReferenceDate, nextDataUrl } from "./daily-artifact";

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

/**
 * "missing": nothing published for today yet (no board and no record, or
 * only an earlier day's board). "omitted": today's crossword was published as
 * omitted, the generator found no board it could prove. "unavailable": the
 * record of today says omitted without any envelope, so the board could not
 * be generated (no confirmed history of the day before, or a generation
 * error). "invalid": anything else.
 */
export type CrosswordErrorKind = "missing" | "invalid" | "omitted" | "unavailable";

export class CrosswordArtifactError extends Error {
  constructor(public readonly kind: CrosswordErrorKind) {
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

// Constants and field sets of schemas/crossword-daily-v1.json, the envelope
// kpop_scraping/crossword_daily.py generates and the daily runner publishes.
export const CROSSWORD_DAILY_SCHEMA_VERSION = "crossword-daily-v1";
export const CROSSWORD_DAILY_ROOT_KEYS = ["schema_version", "reference_date", "seed", "base_id", "previous", "limits", "status", "attempts", "rejections", "eligible_group_count", "connected_group_count", "puzzle", "dataset_version"] as const;
export const CROSSWORD_DAILY_BOARD_KEYS = ["rows", "cols", "entries", "vocabulary", "cells", "audited_group_count", "proof"] as const;

/** Data file of the day's crossword, in data/ and, published ahead, in data/next/. */
export const CROSSWORD_DATA_FILE = "crossword.daily.json";

// Constants and fields of kpop-crossword-publication-v1, the durable record
// kpop_scraping/crossword_publication.py writes beside each published day.
export const CROSSWORD_PUBLICATION_VERSION = "kpop-crossword-publication-v1";
export const CROSSWORD_PUBLICATION_KEYS = ["schema_version", "reference_date", "source", "state", "qids", "dataset_version", "base_id", "previous", "reason"] as const;

/** Record of referenceDate, in data/ (confirmed days) and data/next/ (the day ahead). */
export function crosswordPublicationFile(referenceDate: string): string {
  return `crossword-publication.${referenceDate}.json`;
}

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

export async function crosswordChecksum(puzzle: object): Promise<string> {
  const { dataset_version: _ignored, ...content } = puzzle as { dataset_version?: unknown };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(content))));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const WIKIPEDIA_URL = /^https:\/\/([a-z]{2,3}(?:-[a-z]+)?)\.wikipedia\.org\/w\/index\.php\?curid=([1-9][0-9]*)&oldid=([1-9][0-9]*)$/;
const WIKIPEDIA_LOCATOR = /^wikipedia:([a-z]{2,3}(?:-[a-z]+)?):pageid=([1-9][0-9]*):revid=([1-9][0-9]*)#(?:extract|wikitext)\[(\d+):(\d+)\]$/;

function invalid(): never {
  throw new CrosswordArtifactError("invalid");
}

/** Throws CrosswordArtifactError("invalid") unless the condition holds. */
function ensure(condition: unknown): asserts condition {
  if (!condition) invalid();
}

function isSide(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= CROSSWORD_MAX_SIDE;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Root fields, identity, date and checksum. */
async function checkIdentity(value: unknown): Promise<CrosswordPuzzle> {
  ensure(hasKeys(value, CROSSWORD_ROOT_KEYS));
  const p = value as unknown as CrosswordPuzzle;
  ensure(p.schema_version === CROSSWORD_SCHEMA_VERSION && p.mode === CROSSWORD_MODE && p.puzzle_id === CROSSWORD_PUZZLE_ID);
  ensure(typeof p.dataset_version === "string" && /^[a-f0-9]{64}$/.test(p.dataset_version));
  ensure(typeof p.reference_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.reference_date));
  ensure(isRealDate(p.reference_date));
  ensure((await crosswordChecksum(p)) === p.dataset_version);
  return p;
}

/** Board bounds, entry count, audited count and the list shapes. */
function checkBoardShape(p: CrosswordPuzzle): void {
  ensure(isSide(p.rows) && isSide(p.cols));
  ensure(Array.isArray(p.entries));
  ensure(p.entries.length >= CROSSWORD_MIN_ENTRIES && p.entries.length <= CROSSWORD_MAX_ENTRIES);
  ensure(Number.isInteger(p.audited_group_count) && p.audited_group_count >= p.entries.length);
  ensure(Array.isArray(p.cells) && Array.isArray(p.vocabulary));
  ensure(p.cells.every((c) => hasKeys(c, CROSSWORD_CELL_KEYS)));
}

/** Field set, identity, answer, direction, coordinates and clues of one entry. */
function checkEntryFields(e: CrosswordEntry, ids: Set<string>): string {
  ensure(hasKeys(e, CROSSWORD_ENTRY_KEYS) && hasKeys(e.clue, ["pt-BR", "en"]));
  ensure(Array.isArray(e.aliases) && Array.isArray(e.sources) && Array.isArray(e.matching_qids));
  ensure(typeof e.qid === "string" && /^Q[1-9][0-9]*$/.test(e.qid) && !ids.has(e.qid));
  ensure(typeof e.canonical_name === "string");
  const word = normalizeCrosswordText(e.canonical_name);
  ensure(word && word === e.answer);
  ensure(e.direction === "across" || e.direction === "down");
  ensure(Number.isInteger(e.row) && Number.isInteger(e.col));
  ensure((["pt-BR", "en"] as const).every((l) => typeof e.clue[l] === "string" && e.clue[l].trim()));
  return word;
}

/** No normalized name or alias may point at two groups. */
function checkAliases(e: CrosswordEntry, names: Map<string, string>): void {
  for (const name of [e.canonical_name, ...e.aliases]) {
    ensure(typeof name === "string");
    const alias = normalizeCrosswordText(name);
    ensure(!alias || !names.has(alias) || names.get(alias) === e.qid);
    names.set(alias, e.qid);
  }
}

/** A cited Wikipedia revision whose URL matches its locator, with a non-empty span. */
function checkSource(source: CrosswordSource, qid: string): void {
  ensure(hasKeys(source, CROSSWORD_SOURCE_KEYS));
  ensure(isText(source.predicate) && isText(source.value) && isText(source.snippet));
  const url = typeof source.url === "string" ? source.url.match(WIKIPEDIA_URL) : null;
  const locator = typeof source.locator === "string" ? source.locator.match(WIKIPEDIA_LOCATOR) : null;
  ensure(url && locator);
  ensure(url.slice(1, 4).join(":") === locator.slice(1, 4).join(":"));
  ensure(Number(locator[4]) < Number(locator[5]));
  ensure(typeof source.statement_id === "string" && source.statement_id.startsWith(`${qid}$`));
}

interface Placement {
  expected: Map<string, string>;
  owners: Map<string, CrosswordEntry[]>;
}

/** Places the letters of an entry, rejecting squares off the board and bad crossings. */
function placeEntry(p: CrosswordPuzzle, e: CrosswordEntry, word: string, { expected, owners }: Placement): void {
  for (let i = 0; i < word.length; i++) {
    const key = entryCellKey(e, i);
    const [r, c] = key.split(":").map(Number) as [number, number];
    ensure(r >= 0 && r < p.rows && c >= 0 && c < p.cols);
    const others = owners.get(key) ?? [];
    ensure(!expected.has(key) || (expected.get(key) === word[i] && others.every((o) => o.direction !== e.direction)));
    expected.set(key, word[i]!);
    owners.set(key, [...others, e]);
  }
}

function compareKeys(a: string, b: string): number {
  const [ar, ac] = a.split(":").map(Number) as [number, number];
  const [br, bc] = b.split(":").map(Number) as [number, number];
  return ar - br || ac - bc;
}

/** Numbers follow the reading order of the distinct start squares. */
function checkNumbering(p: CrosswordPuzzle): void {
  const starts = [...new Set(p.entries.map((e) => cellKey(e.row, e.col)))].sort(compareKeys);
  ensure(p.entries.every((e) => e.number === starts.indexOf(cellKey(e.row, e.col)) + 1));
}

/** Every entry is reachable from the first through shared squares. */
function checkConnected(p: CrosswordPuzzle, owners: Map<string, CrosswordEntry[]>, ids: Set<string>): void {
  const reached = new Set([p.entries[0]!.qid]);
  for (const _ of p.entries) {
    for (const group of owners.values()) {
      if (group.some((e) => reached.has(e.qid))) group.forEach((e) => reached.add(e.qid));
    }
  }
  ensure(reached.size === ids.size);
}

/** Vocabulary, unique clues and the cell list match what the entries imply. */
function checkDerivedLists(p: CrosswordPuzzle, expected: Map<string, string>, ids: Set<string>): void {
  ensure(JSON.stringify([...ids].sort()) === JSON.stringify(p.vocabulary));
  ensure(p.entries.every((e) => e.matching_qids.length === 1 && e.matching_qids[0] === e.qid));
  const derived = [...expected.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([key, answer]) => {
      const [row, col] = key.split(":").map(Number) as [number, number];
      return { row, col, answer };
    });
  ensure(JSON.stringify(derived) === JSON.stringify(p.cells.map(({ row, col, answer }) => ({ row, col, answer }))));
}

/**
 * Domain rules of crossword-pilot-v1, mirroring validate() in
 * kpop_scraping/crossword_cli.py: identity and checksum, board bounds,
 * numbering, crossings, connectivity, alias collisions, cited evidence and
 * the cell list derived from the entries. Throws CrosswordArtifactError.
 */
export async function validateCrosswordPuzzle(value: unknown): Promise<CrosswordPuzzle> {
  const p = await checkIdentity(value);
  checkBoard(p);
  return p;
}

function checkBoard(p: CrosswordPuzzle): void {
  checkBoardShape(p);
  const placement: Placement = { expected: new Map(), owners: new Map() };
  const names = new Map<string, string>();
  const ids = new Set<string>();
  for (const e of p.entries) {
    const word = checkEntryFields(e, ids);
    ids.add(e.qid);
    checkAliases(e, names);
    ensure(e.sources.length > 0);
    for (const source of e.sources) checkSource(source, e.qid);
    placeEntry(p, e, word, placement);
  }
  checkNumbering(p);
  checkConnected(p, placement.owners, ids);
  checkDerivedLists(p, placement.expected, ids);
}

export type CrosswordDaily =
  | { status: "ready"; reference_date: string; puzzle: CrosswordPuzzle }
  | { status: "omitted"; reference_date: string };

const QID = /^Q[1-9][0-9]*$/;

function isQidList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((q) => typeof q === "string" && QID.test(q)) && new Set(value).size === value.length;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isRealDate(value);
}

function dayBefore(value: string): string {
  const day = new Date(`${value}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function isInt(value: unknown, min = -Infinity, max = Infinity): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * Canonical previous-day history, as history_context() in
 * kpop_scraping/crossword_daily.py: a bootstrap is dated the same day, any
 * other state the day before; QIDs sorted and unique, 3 to 5 for a played
 * day and none otherwise.
 */
function checkHistory(referenceDate: string, value: unknown): { qids: string[] } {
  ensure(hasKeys(value, ["state", "date", "qids"]));
  const { state, date, qids } = value;
  ensure(state === "bootstrap" || state === "played" || state === "omitted");
  ensure(date === (state === "bootstrap" ? referenceDate : dayBefore(referenceDate)));
  ensure(isQidList(qids) && JSON.stringify(qids) === JSON.stringify([...qids].sort()));
  ensure(state === "played" ? qids.length >= 3 && qids.length <= 5 : qids.length === 0);
  return { qids };
}

/** Generation budgets, attempt count and rejection counts, as in validate_published(). */
function checkAccounting(a: Record<string, unknown>): void {
  ensure(hasKeys(a.limits, ["attempts", "placement_nodes", "proof_nodes"]));
  const limits = a.limits as Record<"attempts" | "placement_nodes" | "proof_nodes", unknown>;
  ensure(Object.values(limits).every((v) => isInt(v, 1, 1000000)));
  ensure(isInt(a.eligible_group_count) && isInt(a.connected_group_count));
  ensure(isInt(a.attempts, 1, limits.attempts as number));
  const rejections = a.rejections;
  ensure(rejections && typeof rejections === "object" && !Array.isArray(rejections));
  const counts = Object.entries(rejections);
  ensure(counts.every(([k, v]) => ["placement", "budget", "validation"].includes(k) && isInt(v, 1)));
  const rejected = counts.reduce((sum, [, v]) => sum + (v as number), 0);
  // An omission spent every attempt; a ready board succeeded on the last one.
  if (a.status === "omitted") ensure(a.attempts === limits.attempts && rejected === a.attempts);
  else ensure(rejected === (a.attempts as number) - 1);
}

/**
 * Rules of crossword-daily-v1 that need no fact base, mirroring
 * validate_published() in kpop_scraping/crossword_daily.py: fields, seed,
 * checksum over the whole envelope, the canonical previous-day history and
 * its exclusion, budgets and attempt accounting, the proof form and the
 * domain rules of the board shared with crossword-pilot-v1. Not mirrored:
 * the canonical order of the entries (canonical_board() in Python) and
 * everything that needs the fact base (factual matching, eligibility counts,
 * the uniqueness proof), which the publisher recomputes before writing. A
 * ready board plays under its envelope checksum.
 */
export async function validateCrosswordDaily(value: unknown): Promise<CrosswordDaily> {
  ensure(hasKeys(value, CROSSWORD_DAILY_ROOT_KEYS));
  const a = value as Record<(typeof CROSSWORD_DAILY_ROOT_KEYS)[number], unknown>;
  ensure(a.schema_version === CROSSWORD_DAILY_SCHEMA_VERSION);
  ensure(isIsoDate(a.reference_date));
  ensure(isText(a.seed));
  ensure(typeof a.base_id === "string" && /^[a-f0-9]{64}$/.test(a.base_id));
  ensure(typeof a.dataset_version === "string" && /^[a-f0-9]{64}$/.test(a.dataset_version));
  ensure((await crosswordChecksum(a)) === a.dataset_version);
  const referenceDate = a.reference_date;
  const previous = checkHistory(referenceDate, a.previous);
  ensure(a.status === "omitted" || a.status === "ready");
  checkAccounting(a);
  if (a.status === "omitted") {
    ensure(a.puzzle === null);
    return { status: "omitted", reference_date: referenceDate };
  }
  ensure(hasKeys(a.puzzle, CROSSWORD_DAILY_BOARD_KEYS));
  const board = a.puzzle as Record<(typeof CROSSWORD_DAILY_BOARD_KEYS)[number], unknown>;
  const proof = board.proof as { solutions?: unknown; complete?: unknown; nodes?: unknown };
  ensure(hasKeys(proof, ["solutions", "complete", "nodes"]) && proof.solutions === 1 && proof.complete === true && Number.isInteger(proof.nodes));
  const puzzle = {
    schema_version: CROSSWORD_DAILY_SCHEMA_VERSION,
    mode: "daily",
    puzzle_id: a.dataset_version,
    dataset_version: a.dataset_version,
    reference_date: referenceDate,
    rows: board.rows,
    cols: board.cols,
    vocabulary: board.vocabulary,
    audited_group_count: board.audited_group_count,
    entries: board.entries,
    cells: board.cells,
  } as CrosswordPuzzle;
  checkBoard(puzzle);
  // No group of the day before comes back.
  ensure(puzzle.vocabulary.every((q) => !previous.qids.includes(q)));
  return { status: "ready", reference_date: referenceDate, puzzle };
}

function dataUrl(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${CROSSWORD_DATA_FILE}`;
}

/** One copy of a data file: null for a 404, "invalid" for any other failure. */
async function fetchValidated<T>(url: string, validate: (value: unknown) => T | Promise<T>, signal?: AbortSignal): Promise<T | null | "invalid"> {
  try {
    const response = await fetch(url, signal ? { signal } : undefined);
    if (response.status === 404) return null;
    if (!response.ok) return "invalid";
    return await validate(await response.json());
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "AbortError") throw error;
    return "invalid";
  }
}

/**
 * State of a kpop-crossword-publication-v1 record dated referenceDate. Only
 * the fields the page acts on are checked in depth; the reason is internal
 * and never shown.
 */
function validateCrosswordRecord(value: unknown, referenceDate: string): "played" | "omitted" {
  ensure(hasKeys(value, CROSSWORD_PUBLICATION_KEYS));
  ensure(value.schema_version === CROSSWORD_PUBLICATION_VERSION && value.reference_date === referenceDate);
  ensure(value.source === "daily" || value.source === "pilot");
  const { state, qids } = value;
  ensure(isQidList(qids));
  if (state === "played") ensure(qids.length >= 3 && qids.length <= 5);
  else ensure(state === "omitted" && qids.length === 0 && isText(value.reason));
  return state as "played" | "omitted";
}

/**
 * Loads today's board from data/ or, published ahead, from data/next/.
 *
 * Only a board dated today plays: an earlier day's board is never shown as
 * today's (the daily runner never reuses one either), and a day published as
 * omitted is "omitted". When both copies carry today, data/ wins, since a
 * promoted day is confirmed there. Without any envelope for today, the
 * publication record of today tells a day whose generation failed
 * ("unavailable") from one not published yet ("missing"). A record that says
 * played without its board, or any unreadable file, is "invalid".
 */
export async function loadCrosswordPuzzle(
  baseUrl?: string,
  signal?: AbortSignal,
  today: string = dailyReferenceDate(),
): Promise<CrosswordPuzzle> {
  const base = baseUrl ?? import.meta.env.BASE_URL;
  const isToday = (c: CrosswordDaily | null | "invalid"): c is CrosswordDaily => !!c && c !== "invalid" && c.reference_date === today;
  const copies = [await fetchValidated(dataUrl(base), validateCrosswordDaily, signal)];
  if (!isToday(copies[0]!)) {
    copies.push(await fetchValidated(nextDataUrl(CROSSWORD_DATA_FILE, base), validateCrosswordDaily, signal));
  }
  const found = copies.find(isToday);
  if (found?.status === "ready") return found.puzzle;
  if (found) throw new CrosswordArtifactError("omitted");
  if (copies.includes("invalid")) throw new CrosswordArtifactError("invalid");
  const record = await loadRecord(base, today, signal);
  if (record === "omitted") throw new CrosswordArtifactError("unavailable");
  throw new CrosswordArtifactError(record === null ? "missing" : "invalid");
}

/** Today's record from data/ or, published ahead, data/next/; data/ wins. */
async function loadRecord(base: string, today: string, signal?: AbortSignal): Promise<"played" | "omitted" | null | "invalid"> {
  const validate = (value: unknown) => validateCrosswordRecord(value, today);
  const file = crosswordPublicationFile(today);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const current = await fetchValidated(`${prefix}data/${file}`, validate, signal);
  if (current !== null) return current;
  return fetchValidated(nextDataUrl(file, base), validate, signal);
}
