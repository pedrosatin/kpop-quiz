import {
  STRANDS_SCHEMA_VERSION,
  isStrandsPuzzle,
  type StrandsPuzzle,
} from "../lib/strands-types";
import type { Locale } from "../lib/quiz-types";
import { isRecord } from "../lib/guards";
import {
  dailyReferenceDate,
  isMissingDailyResponse,
  loadNextDailyWhenMissing,
  preferNextDaily,
} from "./daily-artifact";

export type StrandsArtifactKind = "missing" | "invalid" | "incompatible" | "offline";

export class StrandsArtifactError extends Error {
  constructor(public readonly kind: StrandsArtifactKind) {
    super(`Strands artifact ${kind}`);
  }
}

const FILENAME = "strands.daily.json";

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Recomputes puzzle_id as SHA-256 of the payload without puzzle_id, matching
 * kpop_scraping.strands_schema.compute_strands_puzzle_id.
 */
export async function verifyStrandsIdentity(puzzle: StrandsPuzzle): Promise<StrandsPuzzle> {
  const { puzzle_id: _ignored, ...content } = puzzle;
  const encoded = new TextEncoder().encode(JSON.stringify(canonical(content)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== puzzle.puzzle_id) throw new StrandsArtifactError("invalid");
  return puzzle;
}

function refusePayload(payload: unknown): never {
  if (
    isRecord(payload)
    && Object.hasOwn(payload, "schema_version")
    && payload.schema_version !== STRANDS_SCHEMA_VERSION
  ) {
    throw new StrandsArtifactError("incompatible");
  }
  throw new StrandsArtifactError("invalid");
}

async function accept(puzzle: StrandsPuzzle): Promise<StrandsPuzzle> {
  return verifyStrandsIdentity(puzzle);
}

/**
 * Loads the daily Strands artifact. Prefers data/ when its reference_date is
 * today; after midnight in America/Sao_Paulo, a 404 on the main file falls
 * back to data/next/ via loadNextDailyWhenMissing.
 */
export async function loadStrandsPuzzle(
  _locale: Locale,
  baseUrl?: string,
  today: string = dailyReferenceDate(),
): Promise<StrandsPuzzle> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const targetUrl = dataUrl(FILENAME, effectiveBaseUrl);

  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    throw new StrandsArtifactError("offline");
  }

  if (isMissingDailyResponse(response)) {
    let fromNext: StrandsPuzzle | null;
    try {
      fromNext = await loadNextDailyWhenMissing(FILENAME, effectiveBaseUrl, isStrandsPuzzle, today);
    } catch {
      throw new StrandsArtifactError("offline");
    }
    if (fromNext) return accept(fromNext);
    throw new StrandsArtifactError("missing");
  }
  if (!response.ok) {
    throw new StrandsArtifactError("invalid");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StrandsArtifactError("invalid");
  }

  if (!isStrandsPuzzle(payload)) {
    refusePayload(payload);
  }

  let chosen: StrandsPuzzle;
  try {
    chosen = await preferNextDaily(payload, FILENAME, effectiveBaseUrl, isStrandsPuzzle, today);
  } catch {
    throw new StrandsArtifactError("offline");
  }
  return accept(chosen);
}
