import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIntersectionGrid, isConnectionsPuzzle, isNameGuessPuzzle, isQuizSession, type IntersectionGrid, type ConnectionsPuzzle, type NameGuessPuzzle, type QuizSession } from "../../src/lib/quiz-types";
import { isGridPublication, type GridPublication } from "../../src/data/grid-publication";
import { isWordSearchPuzzle, type WordSearchPuzzle } from "../../src/lib/word-search-types";
import { isTimelinePuzzle, type TimelinePuzzle } from "../../src/lib/timeline-types";
import { isCodeGroupsPuzzle, verifyCodeGroupsIdentity, type CodeGroupsPuzzle } from "../../src/data/code-groups";
import type { CrosswordPuzzle } from "../../src/data/crossword";
import { buildCrosswordDaily } from "../../src/test/crossword-daily-fixture";
import { isStrandsPuzzle, type StrandsPuzzle } from "../../src/lib/strands-types";
import { installGuardClock } from "./guard-clock";

/**
 * Frozen daily artifacts for behaviour E2E. Specs intercept these instead of
 * reading web/public/data for the day. Smoke keeps the live publication.
 */
export const FIXED_DATA_DIR = fileURLToPath(new URL("../fixtures/fixed-data/", import.meta.url));

/** Shared calendar day for the frozen set (Sao Paulo afternoon as "today"). */
export const FIXED_REFERENCE_DATE = "2026-09-17";

/** Identity the corrected-day Grade scenario replaces (valid hash, distinct from the board). */
export const FIXED_REPLACED_GRID_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export type FixedGame =
  | "grid"
  | "connections"
  | "name-guess"
  | "word-search"
  | "timeline"
  | "code"
  | "crossword"
  | "strands"
  | "quiz"
  | "map";

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXED_DATA_DIR, name), "utf8"));
}

function readText(name: string): string {
  return readFileSync(join(FIXED_DATA_DIR, name), "utf8");
}

const HASH = /^[0-9a-f]{64}$/;

type QuizManifest = {
  schema_version: "kpop-quiz-web-manifest-v2";
  dataset_version: string;
  sessions: Record<string, { path: string; session_id: string; sha256: string }>;
};

function isFixedQuizManifest(value: unknown): value is QuizManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (Object.keys(manifest).sort().join() !== "dataset_version,schema_version,sessions"
    || manifest.schema_version !== "kpop-quiz-web-manifest-v2"
    || typeof manifest.dataset_version !== "string" || !HASH.test(manifest.dataset_version)
    || typeof manifest.sessions !== "object" || manifest.sessions === null || Array.isArray(manifest.sessions)) {
    return false;
  }
  const sessions = manifest.sessions as Record<string, unknown>;
  const validKey = (key: string) => /^(?:daily\.)?(?:pt-BR|en)\.(?:assisted|standard|expert)$/.test(key);
  if (!Object.keys(sessions).length || !Object.keys(sessions).every(validKey)) return false;
  return Object.keys(sessions).every((key) => {
    const entry = sessions[key];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    return Object.keys(fields).sort().join() === "path,session_id,sha256"
      && typeof fields.sha256 === "string" && HASH.test(fields.sha256)
      && fields.path === `session.${key}.${fields.sha256}.json`
      && typeof fields.session_id === "string" && HASH.test(fields.session_id);
  });
}

function loadValidated<T>(name: string, guard: (value: unknown) => value is T, label: string): T {
  const raw = readJson(name);
  if (!guard(raw)) throw new Error(`e2e/fixtures/fixed-data/${name} failed ${label}`);
  return raw;
}

const rawGrid = loadValidated("grid.daily.json", isIntersectionGrid, "isIntersectionGrid");
const rawConnections = loadValidated("connections.daily.json", isConnectionsPuzzle, "isConnectionsPuzzle");
const rawNameGuess = loadValidated("name-guess.daily.json", isNameGuessPuzzle, "isNameGuessPuzzle");
const rawWordSearch = loadValidated("word-search.daily.json", isWordSearchPuzzle, "isWordSearchPuzzle");
const rawTimeline = loadValidated("timeline.daily.json", isTimelinePuzzle, "isTimelinePuzzle");
const rawCode = loadValidated("code-groups.daily.json", isCodeGroupsPuzzle, "isCodeGroupsPuzzle");
const rawStrands = loadValidated("strands.daily.json", isStrandsPuzzle, "isStrandsPuzzle");
const rawManifest = readJson("manifest-v2.json");
if (!isFixedQuizManifest(rawManifest)) {
  throw new Error("e2e/fixtures/fixed-data/manifest-v2.json failed isFixedQuizManifest");
}
for (const entry of Object.values(rawManifest.sessions)) {
  const session = JSON.parse(readText(entry.path)) as unknown;
  if (!isQuizSession(session)) {
    throw new Error(`e2e/fixtures/fixed-data/${entry.path} failed isQuizSession`);
  }
  if (session.session_id !== entry.session_id || session.dataset_version !== rawManifest.dataset_version) {
    throw new Error(`e2e/fixtures/fixed-data/${entry.path} identity mismatch vs manifest`);
  }
}

const crosswordPilot = readJson("crossword-pilot.json") as Pick<
  CrosswordPuzzle,
  "rows" | "cols" | "entries" | "vocabulary" | "cells" | "audited_group_count"
>;

/** Small frozen intersection grid (format validated at module load). */
export const fixedGrid: IntersectionGrid = rawGrid;
export const fixedConnections: ConnectionsPuzzle = rawConnections;
export const fixedNameGuess: NameGuessPuzzle = rawNameGuess;
export const fixedWordSearch: WordSearchPuzzle = rawWordSearch;
export const fixedTimeline: TimelinePuzzle = rawTimeline;
export const fixedCodeGroups: CodeGroupsPuzzle = rawCode;
export const fixedStrands: StrandsPuzzle = rawStrands;
export const fixedQuizManifest: QuizManifest = rawManifest;
export const fixedCrosswordPilot = crosswordPilot;

/** Sao Paulo afternoon on the board's own date, so the loader treats it as today. */
export function fixedDailyInstant(referenceDate: string = FIXED_REFERENCE_DATE): Date {
  return new Date(`${referenceDate}T18:00:00.000Z`);
}

export type FixedClockOptions = {
  /**
   * When true (default), install the guard clock at the fixed date so
   * crossGuard can jump cell guards. When false, freeze the page clock only.
   */
  guardClock?: boolean;
  /** Override the wall-clock instant (defaults to the frozen reference date). */
  instant?: Date;
};

async function freezePageClock(page: Page, options: FixedClockOptions, referenceDate: string): Promise<void> {
  const instant = options.instant ?? fixedDailyInstant(referenceDate);
  if (options.guardClock === false) {
    await page.clock.setFixedTime(instant);
  } else {
    await installGuardClock(page, instant);
  }
}

async function hideNextDaily(page: Page, filename: string): Promise<void> {
  await page.route(`**/data/next/${filename}*`, (route) => route.fulfill({ status: 404, body: "" }));
}

async function serveJson(page: Page, filename: string, json: unknown): Promise<void> {
  await hideNextDaily(page, filename);
  await page.route(`**/data/${filename}*`, (route) => route.fulfill({ json }));
}

export type FixedGridServeOptions = FixedClockOptions & {
  /**
   * Non-empty list announces a corrected day (replaces notice). Omit or pass
   * [] for a normal day with no publication sidecar (legacy loader path).
   */
  replaces?: string[];
  /** Serve this board instead of the default frozen grid. */
  grid?: IntersectionGrid;
};

function publicationFor(grid: IntersectionGrid, replaces: string[]): GridPublication {
  const publication: GridPublication = {
    schema_version: "kpop-grid-publication-v1",
    reference_date: grid.reference_date,
    grid_id: grid.grid_id,
    grid_reference_date: grid.reference_date,
    replaces,
  };
  if (!isGridPublication(publication)) {
    throw new Error("fixed-daily publication failed isGridPublication");
  }
  return publication;
}

/**
 * Pins the page clock to the frozen board's date and serves that board on the
 * grid daily routes. Only `/data/**` grid artifacts are rewritten; other
 * requests keep going to the site under test.
 */
export async function serveFixedGrid(
  page: Page,
  options: FixedGridServeOptions = {},
): Promise<IntersectionGrid> {
  const grid = options.grid ?? fixedGrid;
  await freezePageClock(page, options, grid.reference_date);

  const day = grid.reference_date;
  const replaces = options.replaces;

  await hideNextDaily(page, "grid.daily.json");
  await page.route("**/data/grid.daily.json*", (route) => route.fulfill({ json: grid }));

  if (replaces && replaces.length > 0) {
    const publication = publicationFor(grid, replaces);
    await page.route(`**/data/next/grid-publication.${day}.json*`, (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route(`**/data/grid-publication.${day}.json*`, (route) =>
      route.fulfill({ json: publication }),
    );
  } else {
    await page.route("**/data/**/grid-publication.*", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/data/grid-publication.*", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
  }

  return grid;
}

export async function serveFixedConnections(
  page: Page,
  options: FixedClockOptions & { puzzle?: ConnectionsPuzzle } = {},
): Promise<ConnectionsPuzzle> {
  const puzzle = options.puzzle ?? fixedConnections;
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "connections.daily.json", puzzle);
  return puzzle;
}

export async function serveFixedNameGuess(
  page: Page,
  options: FixedClockOptions & { puzzle?: NameGuessPuzzle } = {},
): Promise<NameGuessPuzzle> {
  const puzzle = options.puzzle ?? fixedNameGuess;
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "name-guess.daily.json", puzzle);
  return puzzle;
}

export async function serveFixedWordSearch(
  page: Page,
  options: FixedClockOptions & { puzzle?: WordSearchPuzzle } = {},
): Promise<WordSearchPuzzle> {
  const puzzle = options.puzzle ?? fixedWordSearch;
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "word-search.daily.json", puzzle);
  return puzzle;
}

export async function serveFixedTimeline(
  page: Page,
  options: FixedClockOptions & { puzzle?: TimelinePuzzle } = {},
): Promise<TimelinePuzzle> {
  const puzzle = options.puzzle ?? fixedTimeline;
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "timeline.daily.json", puzzle);
  return puzzle;
}

export async function serveFixedCode(
  page: Page,
  options: FixedClockOptions & { puzzle?: CodeGroupsPuzzle } = {},
): Promise<CodeGroupsPuzzle> {
  const puzzle = options.puzzle ?? fixedCodeGroups;
  await verifyCodeGroupsIdentity(puzzle);
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "code-groups.daily.json", puzzle);
  return puzzle;
}

export async function serveFixedCrossword(
  page: Page,
  options: FixedClockOptions & { board?: typeof crosswordPilot } = {},
): Promise<Record<string, unknown>> {
  const board = options.board ?? crosswordPilot;
  // First published crossword day so the sealed board and share #N match.
  const day = "2026-11-03";
  const daily = await buildCrosswordDaily(board, day);
  await freezePageClock(page, options, day);
  await hideNextDaily(page, "crossword.daily.json");
  await page.route(`**/data/crossword-publication.${day}.json*`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route(`**/data/next/crossword-publication.${day}.json*`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route("**/data/crossword.daily.json*", (route) => route.fulfill({ json: daily }));
  return daily;
}

export async function serveFixedStrands(
  page: Page,
  options: FixedClockOptions & { puzzle?: StrandsPuzzle } = {},
): Promise<StrandsPuzzle> {
  const puzzle = options.puzzle ?? fixedStrands;
  await freezePageClock(page, options, puzzle.reference_date);
  await serveJson(page, "strands.daily.json", puzzle);
  return puzzle;
}

export type FixedQuizServeOptions = FixedClockOptions & {
  /** When true, also 404 catalog probes so the page stays on published sessions. */
  hideCatalog?: boolean;
  /**
   * Serve data/next/ as the day after FIXED_REFERENCE_DATE and freeze the
   * clock on that day, so quiz-clues "tomorrow" stays offline.
   */
  tomorrow?: boolean;
};

/**
 * Serves the frozen quiz manifest and its session files, hides next/ and
 * (by default) catalog probes, and freezes the page clock.
 */
function nextCalendarDay(referenceDate: string): string {
  const day = new Date(`${referenceDate}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Rewrite a daily session seed to `nextDate` and return body + content hash. */
function rewriteDailySessionSeed(body: string, nextDate: string): { body: string; sha256: string } {
  const session = JSON.parse(body) as QuizSession;
  const seed = session.config.seed;
  if (typeof seed === "string" && /^kpop-daily-\d{4}-\d{2}-\d{2}$/.test(seed)) {
    session.config = { ...session.config, seed: `kpop-daily-${nextDate}` };
  }
  const rewritten = JSON.stringify(session);
  return { body: rewritten, sha256: createHash("sha256").update(rewritten).digest("hex") };
}

function indexSessionBodies(manifest: QuizManifest): Map<string, string> {
  const sessionBodies = new Map<string, string>();
  for (const entry of Object.values(manifest.sessions)) {
    sessionBodies.set(entry.path, readText(entry.path));
  }
  for (const name of readdirSync(FIXED_DATA_DIR)) {
    if (name.startsWith("session.") && name.endsWith(".json") && !sessionBodies.has(name)) {
      sessionBodies.set(name, readText(name));
    }
  }
  return sessionBodies;
}

async function hideQuizCatalog(page: Page): Promise<void> {
  await page.route("**/data/catalog-manifest-v1.json*", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/data/catalog.*", (route) => route.fulfill({ status: 404, body: "" }));
}

/**
 * Serves the frozen quiz manifest and its session files, hides next/ and
 * (by default) catalog probes, and freezes the page clock.
 * Pass `tomorrow: true` to publish the same daily sessions under data/next/
 * for the day after FIXED_REFERENCE_DATE and freeze on that day.
 */
export async function serveFixedQuiz(
  page: Page,
  options: FixedQuizServeOptions = {},
): Promise<QuizManifest> {
  const nextDate = nextCalendarDay(FIXED_REFERENCE_DATE);
  const clockDay = options.tomorrow ? nextDate : FIXED_REFERENCE_DATE;
  await freezePageClock(page, options, clockDay);

  await page.route("**/data/manifest-v3.json*", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/data/next/manifest-v3.json*", (route) => route.fulfill({ status: 404, body: "" }));

  const currentBodies = indexSessionBodies(fixedQuizManifest);
  await page.route("**/data/manifest-v2.json*", (route) => route.fulfill({ json: fixedQuizManifest }));
  await page.route("**/data/session.*", (route) => {
    const file = route.request().url().split("/data/").pop()?.split("?")[0] ?? "";
    const body = currentBodies.get(file);
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });

  let served = fixedQuizManifest;
  if (options.tomorrow) {
    const nextManifest: QuizManifest = {
      schema_version: "kpop-quiz-web-manifest-v2",
      dataset_version: fixedQuizManifest.dataset_version,
      sessions: {},
    };
    const nextBodies = new Map<string, string>();
    for (const [key, entry] of Object.entries(fixedQuizManifest.sessions)) {
      if (!key.startsWith("daily.")) {
        nextManifest.sessions[key] = entry;
        nextBodies.set(entry.path, currentBodies.get(entry.path) ?? readText(entry.path));
        continue;
      }
      const original = currentBodies.get(entry.path) ?? readText(entry.path);
      const { body, sha256 } = rewriteDailySessionSeed(original, nextDate);
      const pathName = `session.${key}.${sha256}.json`;
      nextManifest.sessions[key] = { ...entry, path: pathName, sha256 };
      nextBodies.set(pathName, body);
    }
    await page.route("**/data/next/manifest-v2.json*", (route) => route.fulfill({ json: nextManifest }));
    await page.route("**/data/next/session.*", (route) => {
      const file = route.request().url().split("/data/next/").pop()?.split("?")[0] ?? "";
      const body = nextBodies.get(file);
      if (!body) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "application/json", body });
    });
    served = nextManifest;
  } else {
    await page.route("**/data/next/manifest-v2.json*", (route) => route.fulfill({ status: 404, body: "" }));
    await page.route("**/data/next/session.*", (route) => route.fulfill({ status: 404, body: "" }));
  }

  if (options.hideCatalog !== false) await hideQuizCatalog(page);

  return served;
}

/** Map has no daily JSON; freezing the clock selects the round for the fixed day. */
export async function serveFixedMap(page: Page, options: FixedClockOptions = {}): Promise<void> {
  await freezePageClock(page, options, FIXED_REFERENCE_DATE);
}

export type FixedDailyResult =
  | IntersectionGrid
  | ConnectionsPuzzle
  | NameGuessPuzzle
  | WordSearchPuzzle
  | TimelinePuzzle
  | CodeGroupsPuzzle
  | StrandsPuzzle
  | QuizManifest
  | Record<string, unknown>
  | void;

/**
 * Entry point for frozen daily artifacts across games. Smoke keeps reading
 * the live publication; behaviour specs call this before navigation.
 */
export async function serveFixedDaily(
  page: Page,
  game: FixedGame,
  options: FixedGridServeOptions & FixedQuizServeOptions & {
    puzzle?: ConnectionsPuzzle | NameGuessPuzzle | WordSearchPuzzle | TimelinePuzzle | CodeGroupsPuzzle | StrandsPuzzle;
    board?: typeof crosswordPilot;
    grid?: IntersectionGrid;
  } = {},
): Promise<FixedDailyResult> {
  const clock: FixedClockOptions = {
    ...(options.guardClock !== undefined ? { guardClock: options.guardClock } : {}),
    ...(options.instant !== undefined ? { instant: options.instant } : {}),
  };
  switch (game) {
    case "grid":
      return serveFixedGrid(page, options);
    case "connections":
      return serveFixedConnections(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as ConnectionsPuzzle } : {}),
      });
    case "name-guess":
      return serveFixedNameGuess(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as NameGuessPuzzle } : {}),
      });
    case "word-search":
      return serveFixedWordSearch(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as WordSearchPuzzle } : {}),
      });
    case "timeline":
      return serveFixedTimeline(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as TimelinePuzzle } : {}),
      });
    case "code":
      return serveFixedCode(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as CodeGroupsPuzzle } : {}),
      });
    case "crossword":
      return serveFixedCrossword(page, {
        ...clock,
        ...(options.board ? { board: options.board } : {}),
      });
    case "strands":
      return serveFixedStrands(page, {
        ...clock,
        ...(options.puzzle ? { puzzle: options.puzzle as StrandsPuzzle } : {}),
      });
    case "quiz":
      return serveFixedQuiz(page, {
        ...clock,
        ...(options.hideCatalog !== undefined ? { hideCatalog: options.hideCatalog } : {}),
        ...(options.tomorrow !== undefined ? { tomorrow: options.tomorrow } : {}),
      });
    case "map":
      return serveFixedMap(page, clock);
    default: {
      const exhaustive: never = game;
      throw new Error(`serveFixedDaily: game "${String(exhaustive)}" is not wired`);
    }
  }
}

/** Session payload from the frozen quiz set (for specs that need answers offline). */
export function fixedQuizSession(key: keyof QuizManifest["sessions"] | string): QuizSession {
  const entry = fixedQuizManifest.sessions[key];
  if (!entry) throw new Error(`fixed quiz session missing: ${key}`);
  const session = JSON.parse(readText(entry.path)) as unknown;
  if (!isQuizSession(session)) throw new Error(`fixed quiz session invalid: ${key}`);
  return session;
}
