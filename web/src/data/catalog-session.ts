/**
 * Build a ten-question Quiz session from a validated catalog (ADR 026 / Q03).
 *
 * Selection stays inside one language, play mode and filter set. Options are
 * shuffled with the same digest rule as `create_session`. The session id ties
 * catalog version, configuration and selected question ids so results stay
 * idempotent for the same content and distinct across different sets.
 */
import type { Locale, PlayMode, QuizQuestion, QuizSession } from "../lib/quiz-types";
import type { QuizDecadeValue } from "../components/Quiz/url-params";
import {
  CatalogArtifactError,
  eligibleQuestions,
  loadQuizCatalog,
  replayStatus,
  type QuizCatalog,
  type ReplayStatus,
} from "./catalog-loader";

const SESSION_SCHEMA = "kpop-quiz-session-v2";
const SESSION_SIZE = 10;
const PREVIOUS_PREFIX = "kpop-quiz-prev-selection:";

export type CatalogRound = {
  session: QuizSession;
  status: ReplayStatus;
  catalogVersion: string;
  /** Semantic ids of the selected set, sorted, for anti-repeat bookkeeping. */
  semanticKey: string;
  /** Decades with at least one eligible question in this catalog shard. */
  availableDecades: QuizDecadeValue[];
};

export class CatalogSelectionError extends Error {
  constructor(
    public readonly kind: "unavailable" | "invalid" | "missing",
    message: string,
  ) {
    super(message);
    this.name = "CatalogSelectionError";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Same digest helper as Python `quiz_utils.digest`. */
export async function digest(...parts: string[]): Promise<string> {
  return sha256Text(parts.join("\x1f"));
}

async function hashPayload(payload: unknown): Promise<string> {
  return sha256Text(JSON.stringify(canonical(payload)));
}

function decadeKey(decades: readonly QuizDecadeValue[]): string {
  return [...new Set(decades)].sort((a, b) => a - b).join(",");
}

function selectionStorageKey(
  catalogVersion: string,
  locale: Locale,
  playMode: PlayMode,
  decades: readonly QuizDecadeValue[],
): string {
  return `${PREVIOUS_PREFIX}${catalogVersion}:${locale}:${playMode}:${decadeKey(decades) || "all"}`;
}

function semanticKeyOf(questions: readonly QuizQuestion[]): string {
  return [...questions.map((question) => question.semantic_id)].sort().join(",");
}

function sameSemanticSet(a: readonly QuizQuestion[], b: ReadonlySet<string>): boolean {
  if (a.length !== b.size) return false;
  return a.every((question) => b.has(question.semantic_id));
}

export function readPreviousSemanticSet(storageKey: string): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string" && item.length > 0)) {
      return null;
    }
    return new Set(parsed as string[]);
  } catch {
    return null;
  }
}

export function writePreviousSemanticSet(storageKey: string, semanticIds: readonly string[]): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...semanticIds].sort()));
  } catch {
    // sessionStorage may be unavailable; anti-repeat then lasts only in memory.
  }
}

export function clearPreviousSemanticSet(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // optional
  }
}

/** Shuffle options the way `create_session` does, with a stable seed. */
export async function sessionQuestion(question: QuizQuestion, seed: string): Promise<QuizQuestion> {
  const ranked = await Promise.all(
    question.options.map(async (option) => ({
      option,
      rank: await digest(seed, question.logical_id, option.id),
    })),
  );
  ranked.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return { ...question, options: ranked.map(({ option }) => option) };
}

async function orderBySeed(
  questions: readonly QuizQuestion[],
  seed: string,
  catalogVersion: string,
): Promise<QuizQuestion[]> {
  const ranked = await Promise.all(
    questions.map(async (question) => ({
      question,
      rank: await digest(seed, catalogVersion, question.logical_id),
    })),
  );
  ranked.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return ranked.map(({ question }) => question);
}

/**
 * Pick ten distinct questions. When another combination exists, skip the
 * immediately previous semantic set (order does not count as a new set).
 */
export async function selectQuestions(
  eligible: readonly QuizQuestion[],
  catalogVersion: string,
  seedBase: string,
  previous: ReadonlySet<string> | null,
): Promise<{ questions: QuizQuestion[]; status: ReplayStatus }> {
  const status = replayStatus(eligible.length);
  if (status === "unavailable") {
    throw new CatalogSelectionError(
      "unavailable",
      `eligible ${eligible.length}; a round needs ${SESSION_SIZE}`,
    );
  }
  if (status === "repeats") {
    const ordered = await orderBySeed(eligible, seedBase, catalogVersion);
    return { questions: ordered, status };
  }

  const limit = Math.max(eligible.length, SESSION_SIZE + 1);
  for (let nonce = 0; nonce < limit; nonce += 1) {
    const seed = nonce === 0 ? seedBase : `${seedBase}:${nonce}`;
    const ordered = await orderBySeed(eligible, seed, catalogVersion);
    const picked = ordered.slice(0, SESSION_SIZE);
    if (!previous || !sameSemanticSet(picked, previous)) {
      return { questions: picked, status };
    }
  }
  // Exhausted nonces while every top-10 matched the previous set — still
  // return a valid round; the player was warned only when status is repeats.
  const fallback = (await orderBySeed(eligible, seedBase, catalogVersion)).slice(0, SESSION_SIZE);
  return { questions: fallback, status };
}

export async function buildCatalogSession(
  catalog: QuizCatalog,
  questions: readonly QuizQuestion[],
  decades: readonly QuizDecadeValue[],
): Promise<QuizSession> {
  if (questions.length !== SESSION_SIZE) {
    throw new CatalogSelectionError("invalid", `selection size ${questions.length}`);
  }
  const semanticIds = questions.map((question) => question.semantic_id);
  if (new Set(semanticIds).size !== SESSION_SIZE) {
    throw new CatalogSelectionError("invalid", "duplicate semantic_id in selection");
  }
  const resolvedDecades = [...new Set(decades)].sort((a, b) => a - b);
  const decade = resolvedDecades.length === 1 ? resolvedDecades[0]! : null;
  // Seed is derived from catalog version, filters and the selected set so the
  // same content always shuffles options the same way and yields the same id.
  const seed = await sha256Text([
    "catalog-round",
    catalog.catalogVersion,
    catalog.locale,
    catalog.playMode,
    decadeKey(resolvedDecades) || "all",
    semanticKeyOf(questions),
  ].join("\n"));
  const selected = await Promise.all(questions.map((question) => sessionQuestion(question, seed)));
  const config = {
    play_mode: catalog.playMode,
    group_id: null,
    language: catalog.locale,
    seed,
    theme: null,
    timer_seconds: null,
    decade,
  };
  const sessionId = await hashPayload({
    catalog_version: catalog.catalogVersion,
    config,
    dataset_version: catalog.datasetVersion,
    question_ids: selected.map((question) => question.id),
    schema_version: SESSION_SCHEMA,
  });
  return {
    schema_version: SESSION_SCHEMA,
    dataset_version: catalog.datasetVersion,
    session_id: sessionId,
    config,
    questions: selected,
  };
}

export type SelectCatalogRoundOptions = {
  locale: Locale;
  playMode: PlayMode;
  decades?: readonly QuizDecadeValue[];
  /** When true, avoid the stored previous set if another combination exists. */
  avoidPrevious?: boolean;
  baseUrl?: string;
  /** Injected catalog (tests). */
  catalog?: QuizCatalog;
  /** Override previous semantic ids (tests / in-memory handoff). */
  previousSemanticIds?: readonly string[] | null;
};

/**
 * Load the catalog (unless injected), select ten questions and return a session
 * ready for the Quiz. Missing/invalid catalog surfaces as CatalogSelectionError
 * with the same kind the loader used — no fallback to unvalidated content here.
 */
export async function selectCatalogRound(options: SelectCatalogRoundOptions): Promise<CatalogRound> {
  const decades = options.decades ?? [];
  let catalog: QuizCatalog;
  try {
    catalog = options.catalog ?? await loadQuizCatalog(options.locale, options.playMode, options.baseUrl);
  } catch (error) {
    if (error instanceof CatalogArtifactError) {
      throw new CatalogSelectionError(error.kind, error.reason);
    }
    throw error;
  }
  if (catalog.locale !== options.locale || catalog.playMode !== options.playMode) {
    throw new CatalogSelectionError("invalid", "catalog locale or mode mismatch");
  }

  const eligible = eligibleQuestions(catalog, decades);
  const storageKey = selectionStorageKey(
    catalog.catalogVersion, options.locale, options.playMode, decades,
  );
  const previous = options.avoidPrevious === false
    ? null
    : options.previousSemanticIds !== undefined
      ? (options.previousSemanticIds ? new Set(options.previousSemanticIds) : null)
      : readPreviousSemanticSet(storageKey);

  const seedBase = [
    "catalog-select",
    catalog.catalogVersion,
    options.locale,
    options.playMode,
    decadeKey(decades) || "all",
  ].join("|");

  const { questions, status } = await selectQuestions(
    eligible, catalog.catalogVersion, seedBase, previous,
  );
  const session = await buildCatalogSession(catalog, questions, decades);
  const semanticKey = semanticKeyOf(session.questions);
  writePreviousSemanticSet(
    storageKey,
    session.questions.map((question) => question.semantic_id),
  );
  return {
    session,
    status,
    catalogVersion: catalog.catalogVersion,
    semanticKey,
    availableDecades: catalogAvailableDecades(catalog),
  };
}

/** Decades that have at least one eligible question in the published catalog. */
export function catalogAvailableDecades(catalog: QuizCatalog): QuizDecadeValue[] {
  return ([1990, 2000, 2010, 2020] as const).filter((decade) => {
    const pool = catalog.pools[`decade.${decade}`];
    return Boolean(pool && pool.length > 0);
  });
}
