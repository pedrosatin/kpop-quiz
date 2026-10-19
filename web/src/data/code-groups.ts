import type { Locale } from "../lib/quiz-types";
import { preferNextDaily } from "./daily-artifact";

export interface CodeGroupsSource {
  revision_id: number;
  locator: string;
  url: string;
}

export interface CodeGroupsSymbol {
  qid: string;
  name: string;
  source: CodeGroupsSource;
}

export interface CodeGroupsPuzzle {
  schema_version: string;
  mode: string;
  puzzle_id: string;
  dataset_version: string;
  reference_date: string;
  seed: string;
  symbols: CodeGroupsSymbol[];
  secret: string[];
  max_attempts: number;
}

export interface CodeGroupsGuess {
  ids: string[];
  exact: number;
  misplaced: number;
}

export class CodeGroupsArtifactError extends Error {
  constructor(public readonly kind: "missing" | "invalid") {
    super(`Code groups artifact ${kind}`);
  }
}

const HASH = /^[a-f0-9]{64}$/;
const QID = /^Q[1-9][0-9]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural contract of the generator (kpop_scraping/code_groups_cli.py),
 * without the hash: preferNextDaily needs a synchronous guard, and the
 * identity of both the main and the next/ copy is verified afterwards.
 */
export function isCodeGroupsPuzzle(value: unknown): value is CodeGroupsPuzzle {
  const p = value as CodeGroupsPuzzle;
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (p.schema_version !== "code-groups-pilot-v1" || p.mode !== "pilot" || p.max_attempts !== 10) return false;
  if (Object.keys(p).length !== 9) return false;
  if (![p.puzzle_id, p.dataset_version, p.seed, p.reference_date].every((s) => typeof s === "string" && s.trim().length > 0)) return false;
  if (!HASH.test(p.puzzle_id) || !HASH.test(p.dataset_version)) return false;
  if (!DATE.test(p.reference_date) || new Date(`${p.reference_date}T12:00:00Z`).toISOString().slice(0, 10) !== p.reference_date) return false;
  if (!Array.isArray(p.symbols) || p.symbols.length !== 6) return false;
  for (const s of p.symbols) {
    if (!s || typeof s !== "object" || Object.keys(s).length !== 3) return false;
    if (typeof s.qid !== "string" || !QID.test(s.qid)) return false;
    if (typeof s.name !== "string" || !s.name.trim()) return false;
    if (!s.source || typeof s.source !== "object" || Object.keys(s.source).length !== 3) return false;
    if (!Number.isSafeInteger(s.source.revision_id) || s.source.revision_id < 1) return false;
    if (s.source.locator !== "claims.P31") return false;
    if (s.source.url !== `https://www.wikidata.org/w/index.php?title=${s.qid}&oldid=${s.source.revision_id}`) return false;
  }
  const ids = new Set(p.symbols.map((s) => s.qid));
  if (ids.size !== 6) return false;
  if (!Array.isArray(p.secret) || p.secret.length !== 4 || new Set(p.secret).size !== 4) return false;
  return p.secret.every((id) => ids.has(id));
}

/** Aggregate feedback of one guess against the secret. */
export function scoreGuess(puzzle: CodeGroupsPuzzle, ids: readonly string[]): CodeGroupsGuess {
  const exact = ids.filter((id, index) => id === puzzle.secret[index]).length;
  const misplaced = ids.filter((id) => puzzle.secret.includes(id)).length - exact;
  return { ids: [...ids], exact, misplaced };
}

// Python identity uses sorted keys and the default JSON separators.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}: ${canonical((value as Record<string, unknown>)[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Recomputes puzzle_id from the content (SHA-256 over the Python canonical
 * JSON) and rejects a mismatch, so a tampered or mixed artifact never plays.
 */
export async function verifyCodeGroupsIdentity(puzzle: CodeGroupsPuzzle): Promise<CodeGroupsPuzzle> {
  const content = canonical([puzzle.schema_version, puzzle.dataset_version, puzzle.reference_date, puzzle.seed, puzzle.symbols, puzzle.secret]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== puzzle.puzzle_id) throw new CodeGroupsArtifactError("invalid");
  return puzzle;
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

/**
 * Loads the daily group code artifact. The main copy and the next/ copy
 * both carry the day's puzzle; every loaded candidate goes through the
 * structural guard and then the identity check.
 */
export async function loadCodeGroupsPuzzle(
  _locale: Locale,
  baseUrl?: string,
): Promise<CodeGroupsPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "code-groups.daily.json";

  let response: Response;
  try {
    response = await fetch(dataUrl(filename, effectiveBaseUrl));
  } catch {
    throw new CodeGroupsArtifactError("invalid");
  }

  if (response.status === 404) throw new CodeGroupsArtifactError("missing");
  if (!response.ok) throw new CodeGroupsArtifactError("invalid");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CodeGroupsArtifactError("invalid");
  }

  if (!isCodeGroupsPuzzle(payload)) throw new CodeGroupsArtifactError("invalid");

  const chosen = await preferNextDaily(payload, filename, effectiveBaseUrl, isCodeGroupsPuzzle);
  return verifyCodeGroupsIdentity(chosen);
}
