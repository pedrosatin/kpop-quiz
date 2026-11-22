import type { Locale } from "../lib/quiz-types";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";
import {
  hasDistinctItems,
  hasExactKeys,
  isHash,
  isIntegerInRange,
  isLenientIsoDate,
  isNonBlankString,
  isQid,
  isRecord,
} from "../lib/guards";

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

const PUZZLE_FIELDS = [
  "schema_version", "mode", "puzzle_id", "dataset_version", "reference_date", "seed", "symbols", "secret", "max_attempts",
];

/** A Wikidata revision of the symbol's P31 claim, linked by its permanent URL. */
function isSymbolSource(value: unknown, qid: string): boolean {
  // The revision must be a safe integer, unlike the revision ids of the other games.
  return isRecord(value)
    && hasExactKeys(value, ["revision_id", "locator", "url"])
    && isIntegerInRange(value.revision_id, 1, Number.MAX_SAFE_INTEGER)
    && value.locator === "claims.P31"
    && value.url === `https://www.wikidata.org/w/index.php?title=${qid}&oldid=${value.revision_id}`;
}

function isSymbol(value: unknown): value is CodeGroupsSymbol {
  return isRecord(value)
    && hasExactKeys(value, ["qid", "name", "source"])
    && isQid(value.qid)
    && isNonBlankString(value.name)
    && isSymbolSource(value.source, value.qid);
}

/**
 * Structural contract of the generator (kpop_scraping/code_groups_cli.py),
 * without the hash: preferNextDaily needs a synchronous guard, and the
 * identity of both the main and the next/ copy is verified afterwards.
 */
export function isCodeGroupsPuzzle(value: unknown): value is CodeGroupsPuzzle {
  if (!isRecord(value)) return false;
  const p = value as unknown as CodeGroupsPuzzle;
  if (p.schema_version !== "code-groups-pilot-v1" || p.mode !== "pilot" || p.max_attempts !== 10) return false;
  // The root is counted and its names are not checked, so a misnamed key still
  // reaches the later field checks the way the original guard did.
  if (Object.keys(value).length !== PUZZLE_FIELDS.length) return false;
  if (![p.puzzle_id, p.dataset_version, p.seed, p.reference_date].every(isNonBlankString)) return false;
  if (!isHash(p.puzzle_id) || !isHash(p.dataset_version)) return false;
  if (!isLenientIsoDate(p.reference_date)) return false;
  if (!Array.isArray(p.symbols) || p.symbols.length !== 6) return false;
  for (const symbol of p.symbols) {
    if (!isSymbol(symbol)) return false;
  }
  const ids = new Set(p.symbols.map((s) => s.qid));
  if (ids.size !== 6) return false;
  if (!Array.isArray(p.secret) || p.secret.length !== 4 || !hasDistinctItems(p.secret)) return false;
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
  today: string = dailyReferenceDate(),
): Promise<CodeGroupsPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const filename = "code-groups.daily.json";

  let response: Response;
  try {
    response = await fetch(dataUrl(filename, effectiveBaseUrl));
  } catch {
    throw new CodeGroupsArtifactError("invalid");
  }

  if (isMissingDailyResponse(response)) {
    const fromNext = await loadNextDailyWhenMissing(filename, effectiveBaseUrl, isCodeGroupsPuzzle, today);
    if (fromNext) return verifyCodeGroupsIdentity(fromNext);
    throw new CodeGroupsArtifactError("missing");
  }
  if (!response.ok) throw new CodeGroupsArtifactError("invalid");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CodeGroupsArtifactError("invalid");
  }

  if (!isCodeGroupsPuzzle(payload)) throw new CodeGroupsArtifactError("invalid");

  const chosen = await preferNextDaily(payload, filename, effectiveBaseUrl, isCodeGroupsPuzzle, today);
  return verifyCodeGroupsIdentity(chosen);
}
