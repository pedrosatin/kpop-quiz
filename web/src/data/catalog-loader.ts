import { isQuestion, type Locale, type PlayMode, type QuizQuestion } from "../lib/quiz-types";
import type { QuizDecadeValue } from "../components/Quiz/url-params";
import { QuizArtifactError } from "./session-loader";

/**
 * Consumer of the static question catalog (ADR 026).
 *
 * The catalog lists, per language and play mode, every question a new round may
 * draw from and which of them each filter allows. Nothing here is wired to the
 * Quiz yet: a round still comes from `session-loader.ts`. This module only
 * returns a catalog after every layer agrees (manifest, bytes, schema, identity,
 * language, mode, version, pools); anything else is a `CatalogArtifactError`,
 * with no fallback to content that was not validated.
 */

/** Why a catalog artifact was refused; `kind` is what the UI maps to a message. */
export class CatalogArtifactError extends QuizArtifactError {
  constructor(kind: "missing" | "invalid", public readonly reason: string) {
    super(kind);
    this.message = `Quiz catalog ${kind}: ${reason}`;
  }
}

const MANIFEST_FILENAME = "catalog-manifest-v1.json";
const MANIFEST_SCHEMA = "kpop-quiz-catalog-manifest-v1";
const SHARD_SCHEMA = "kpop-quiz-catalog-v1";
const LOCALES = ["pt-BR", "en"] as const;
const MODES = ["assisted", "standard", "expert"] as const;
const DECADES = [1990, 2000, 2010, 2020] as const;
const POOL_KEYS = ["all", ...DECADES.map((decade) => `decade.${decade}`)] as const;
const SESSION_SIZE = 10;
const HASH = /^[0-9a-f]{64}$/;

export type CatalogPoolKey = (typeof POOL_KEYS)[number];
export type ReplayStatus = "ok" | "repeats" | "unavailable";

interface ManifestEntry {
  path: string;
  sha256: string;
  questions: number;
  pools: Record<CatalogPoolKey, number>;
}

export interface CatalogManifest {
  schema_version: typeof MANIFEST_SCHEMA;
  catalog_version: string;
  dataset_version: string;
  reference_date: string;
  shards: Record<string, ManifestEntry>;
}

export interface QuizCatalog {
  catalogVersion: string;
  datasetVersion: string;
  referenceDate: string;
  locale: Locale;
  playMode: PlayMode;
  questions: readonly QuizQuestion[];
  /** Ascending indexes into `questions`, per filter. */
  pools: Readonly<Record<CatalogPoolKey, readonly number[]>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dataUrl(filename: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}data/${filename}`;
}

/** How a pool of `eligible` questions serves a new round of ten. */
export function replayStatus(eligible: number): ReplayStatus {
  if (eligible > SESSION_SIZE) return "ok";
  return eligible === SESSION_SIZE ? "repeats" : "unavailable";
}

/** The version a catalog manifest must declare for its dataset and shard hashes. */
async function expectedCatalogVersion(datasetVersion: string, shards: Record<string, ManifestEntry>): Promise<string> {
  const lines = [MANIFEST_SCHEMA, datasetVersion, ...Object.keys(shards).sort().map((key) => `${key}:${shards[key]!.sha256}`)];
  return sha256(new TextEncoder().encode(lines.join("\n")));
}

function isEntry(key: string, value: unknown): value is ManifestEntry {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "pools", "questions", "sha256"])) return false;
  if (!isHash(value.sha256) || value.path !== `catalog.${key}.${value.sha256}.json`) return false;
  if (!Number.isInteger(value.questions) || (value.questions as number) < 1) return false;
  const pools = value.pools;
  return isRecord(pools) && hasExactKeys(pools, POOL_KEYS)
    && POOL_KEYS.every((pool) => Number.isInteger(pools[pool]) && (pools[pool] as number) >= 0 && (pools[pool] as number) <= (value.questions as number))
    && (pools.all as number) > 0;
}

async function parseManifest(value: unknown): Promise<CatalogManifest> {
  if (!isRecord(value) || !hasExactKeys(value, ["catalog_version", "dataset_version", "reference_date", "schema_version", "shards"])) {
    throw new CatalogArtifactError("invalid", "manifest fields");
  }
  if (value.schema_version !== MANIFEST_SCHEMA) throw new CatalogArtifactError("invalid", "manifest schema");
  if (!isHash(value.dataset_version) || !isHash(value.catalog_version) || !isIsoDate(value.reference_date)) {
    throw new CatalogArtifactError("invalid", "manifest identity");
  }
  const shards = value.shards;
  const expectedKeys = LOCALES.flatMap((locale) => MODES.map((mode) => `${locale}.${mode}`));
  if (!isRecord(shards) || !hasExactKeys(shards, expectedKeys)) throw new CatalogArtifactError("invalid", "manifest shards");
  if (!expectedKeys.every((key) => isEntry(key, shards[key]))) throw new CatalogArtifactError("invalid", "manifest shard entry");
  const manifest = value as unknown as CatalogManifest;
  if (value.catalog_version !== await expectedCatalogVersion(manifest.dataset_version, manifest.shards)) {
    throw new CatalogArtifactError("invalid", "manifest catalog version");
  }
  return manifest;
}

async function fetchManifest(baseUrl: string): Promise<CatalogManifest> {
  let response: Response;
  try {
    response = await fetch(dataUrl(MANIFEST_FILENAME, baseUrl));
  } catch {
    throw new CatalogArtifactError("missing", "manifest request failed");
  }
  if (response.status === 404) throw new CatalogArtifactError("missing", "manifest not published");
  if (!response.ok) throw new CatalogArtifactError("invalid", `manifest status ${response.status}`);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
  } catch {
    throw new CatalogArtifactError("invalid", "manifest is not JSON");
  }
  return parseManifest(payload);
}

/**
 * What the published catalog offers, from the manifest alone: the version and,
 * per language and play mode, the eligible count and replay status of every
 * filter. It downloads no shard, so a screen can say a filter has no variety
 * before asking for the questions.
 */
export async function loadCatalogAvailability(baseUrl?: string) {
  const manifest = await fetchManifest(baseUrl ?? import.meta.env.BASE_URL);
  const shards = Object.fromEntries(Object.entries(manifest.shards).map(([key, entry]) => [
    key,
    Object.fromEntries(POOL_KEYS.map((pool) => {
      const eligible = entry.pools[pool]!;
      return [pool, { eligible, replay: replayStatus(eligible) }];
    })) as Record<CatalogPoolKey, { eligible: number; replay: ReplayStatus }>,
  ]));
  return { catalogVersion: manifest.catalog_version, datasetVersion: manifest.dataset_version, shards };
}

function parseShard(
  payload: unknown, manifest: CatalogManifest, entry: ManifestEntry, locale: Locale, playMode: PlayMode,
): QuizCatalog {
  const invalid = (reason: string) => new CatalogArtifactError("invalid", reason);
  if (!isRecord(payload) || !hasExactKeys(payload, [
    "dataset_version", "generator_version", "language", "play_mode", "pools", "questions",
    "reference_date", "schema_version", "source_policy_version", "template_version",
  ])) throw invalid("shard fields");
  if (payload.schema_version !== SHARD_SCHEMA) throw invalid("shard schema");
  if (payload.dataset_version !== manifest.dataset_version) throw invalid("shard dataset version");
  if (payload.reference_date !== manifest.reference_date) throw invalid("shard reference date");
  if (payload.language !== locale) throw invalid("shard language");
  if (payload.play_mode !== playMode) throw invalid("shard play mode");
  for (const field of ["generator_version", "template_version", "source_policy_version"] as const) {
    if (typeof payload[field] !== "string" || !payload[field]) throw invalid(`shard ${field}`);
  }
  const questions = payload.questions;
  if (!Array.isArray(questions) || questions.length !== entry.questions) throw invalid("shard questions");
  const ids = new Set<string>();
  const semanticIds = new Set<string>();
  let previousLogicalId = "";
  for (const question of questions) {
    if (!isQuestion(question, locale) || question.play_mode !== playMode) throw invalid("shard question");
    if (question.reference_date !== manifest.reference_date) throw invalid("shard question reference date");
    if (ids.has(question.id) || semanticIds.has(question.semantic_id)) throw invalid("shard question identity");
    if (question.logical_id <= previousLogicalId) throw invalid("shard question order");
    ids.add(question.id);
    semanticIds.add(question.semantic_id);
    previousLogicalId = question.logical_id;
  }
  const pools = payload.pools;
  if (!isRecord(pools) || !hasExactKeys(pools, POOL_KEYS)) throw invalid("shard pools");
  const referenced = new Set<number>();
  for (const key of POOL_KEYS) {
    const indexes = pools[key];
    if (!Array.isArray(indexes) || indexes.length !== entry.pools[key]) throw invalid(`shard pool ${key}`);
    const decade = key === "all" ? null : Number(key.slice("decade.".length));
    indexes.forEach((index, position) => {
      if (!Number.isInteger(index) || index < 0 || index >= questions.length
        || (position > 0 && (indexes[position - 1] as number) >= index)) throw invalid(`shard pool ${key}`);
      if (decade !== null && !(questions[index] as QuizQuestion).decades?.includes(decade)) throw invalid(`shard pool ${key} decade`);
      referenced.add(index);
    });
  }
  if (referenced.size !== questions.length) throw invalid("shard question outside every pool");
  return {
    catalogVersion: manifest.catalog_version,
    datasetVersion: manifest.dataset_version,
    referenceDate: manifest.reference_date,
    locale,
    playMode,
    questions: questions as QuizQuestion[],
    pools: pools as Record<CatalogPoolKey, number[]>,
  };
}

// Validated shards by content hash: the manifest is fetched on every load, so a
// newer catalog is always noticed, and a shard seen before is not parsed again.
const validated = new Map<string, QuizCatalog>();

/** Forget validated shards (tests, and a way to drop them after a failure). */
export function clearCatalogCache(): void {
  validated.clear();
}

export async function loadQuizCatalog(locale: Locale, playMode: PlayMode, baseUrl?: string): Promise<QuizCatalog> {
  const effectiveBaseUrl = baseUrl ?? import.meta.env.BASE_URL;
  const manifest = await fetchManifest(effectiveBaseUrl);
  const entry = manifest.shards[`${locale}.${playMode}`];
  if (!entry) throw new CatalogArtifactError("invalid", "manifest shards");
  const cached = validated.get(entry.sha256);
  if (cached) return cached;
  let response: Response;
  try {
    response = await fetch(dataUrl(entry.path, effectiveBaseUrl));
  } catch {
    throw new CatalogArtifactError("missing", "shard request failed");
  }
  if (response.status === 404) throw new CatalogArtifactError("missing", "shard not published");
  if (!response.ok) throw new CatalogArtifactError("invalid", `shard status ${response.status}`);
  let payload: unknown;
  try {
    const bytes = await response.arrayBuffer();
    if (await sha256(bytes) !== entry.sha256) throw new CatalogArtifactError("invalid", "shard hash");
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof CatalogArtifactError) throw error;
    throw new CatalogArtifactError("invalid", "shard is not JSON");
  }
  const catalog = parseShard(payload, manifest, entry, locale, playMode);
  validated.set(entry.sha256, catalog);
  return catalog;
}

/**
 * The questions a round may draw from for the chosen decades, each once.
 * With no decade the unfiltered pool; with several, the union of their pools,
 * where a question that belongs to more than one decade counts once.
 */
export function eligibleQuestions(catalog: QuizCatalog, decades: readonly QuizDecadeValue[] = []): QuizQuestion[] {
  const keys: CatalogPoolKey[] = decades.length
    ? [...new Set(decades)].sort((a, b) => a - b).map((decade) => `decade.${decade}` as CatalogPoolKey)
    : ["all"];
  const indexes = new Set<number>();
  for (const key of keys) {
    const pool = catalog.pools[key];
    if (!pool) throw new CatalogArtifactError("invalid", `unknown filter ${key}`);
    for (const index of pool) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => catalog.questions[index]!);
}
