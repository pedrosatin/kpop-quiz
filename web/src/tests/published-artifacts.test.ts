import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isConnectionsPuzzle,
  isIntersectionGrid,
  isNameGuessPuzzle,
  isQuizSession,
  isTimelinePuzzle,
  type QuizSession,
} from "../lib/quiz-types";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import {
  isCodeGroupsPuzzle,
  verifyCodeGroupsIdentity,
  type CodeGroupsPuzzle,
} from "../data/code-groups";
import { validateCrosswordDaily, validateCrosswordPuzzle } from "../data/crossword";
import publishedCrossword from "../../public/data/crossword-pilot.json";
import publishedCodePilot from "../../public/data/code-groups.pilot.json";
import { clearCatalogCache, loadQuizCatalog } from "../data/catalog-loader";

const DATA_DIR = join(import.meta.dirname, "../../public/data");

interface ManifestEntry {
  path: string;
  sha256: string;
  session_id: string;
}

interface Manifest {
  schema_version: string;
  dataset_version: string;
  sessions: Record<string, ManifestEntry>;
}

/** The parsed file, or undefined when the day was published without it. */
function readPublished(dir: string, name: string): unknown {
  const path = join(dir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

function readManifest(dir: string, name = "manifest-v2.json"): Manifest | undefined {
  return readPublished(dir, name) as Manifest | undefined;
}

function readSession(dir: string, entry: ManifestEntry): unknown {
  return JSON.parse(readFileSync(join(dir, entry.path), "utf-8"));
}

// The partial publish policy may leave any daily game out of a day (see
// daily-set.json); a day without the file has nothing to check here, and its
// page shows the missing state. A file that is published must validate.
const DAILY_BOARDS: readonly (readonly [string, (value: unknown) => boolean])[] = [
  ["connections.daily.json", isConnectionsPuzzle],
  ["name-guess.daily.json", isNameGuessPuzzle],
  ["word-search.daily.json", isWordSearchPuzzle],
  ["timeline.daily.json", isTimelinePuzzle],
  ["grid.daily.json", isIntersectionGrid],
];

/** Daily boards in `dir` that are published but fail their schema. */
function invalidDailyBoards(dir: string): string[] {
  return DAILY_BOARDS.filter(([name, isValid]) => {
    const payload = readPublished(dir, name);
    return payload !== undefined && !isValid(payload);
  }).map(([name]) => name);
}

/** What is wrong with the quiz manifest of `dir`; empty when it is fine or absent. */
function quizManifestProblems(dir: string): string[] {
  const manifest = readManifest(dir);
  if (manifest === undefined) return [];
  const problems: string[] = [];
  if (manifest.schema_version !== "kpop-quiz-web-manifest-v2") problems.push("manifest schema");
  const entries = Object.entries(manifest.sessions);
  if (entries.length === 0) problems.push("manifest lists no session");
  for (const [key, entry] of entries) {
    const session = readSession(dir, entry);
    if (!isQuizSession(session)) {
      problems.push(`session ${key} (${entry.path})`);
      continue;
    }
    // A client released before related clues existed rejects any session
    // whose clue cites a fact outside its question, and it reads this
    // manifest on every game: that client's own rule, applied here.
    for (const question of session.questions) {
      for (const clue of question.clues_available) {
        if (!clue.fact_base_ids.every((id) => question.fact_base_ids.includes(id))) {
          problems.push(`session ${key}: clue ${clue.id} cites a fact outside its question`);
        }
      }
    }
  }
  return problems;
}

// Behavioural tests read frozen copies under src/tests/fixtures so the suite does
// not break every time the daily cron regenerates the artifacts. These checks stay
// pointed at the real published files, asserting schema compliance only.
describe("published daily artifacts", () => {
  it("publishes schema-compliant daily boards for the games the day has", () => {
    expect(invalidDailyBoards(DATA_DIR)).toEqual([]);
  });

  it("publishes the audited crossword board", async () => {
    await expect(validateCrosswordPuzzle(structuredClone(publishedCrossword))).resolves.toBeTruthy();
  });

  it("publishes a valid daily crossword in data/ and data/next/ when the day has one", async () => {
    for (const path of [join(DATA_DIR, "crossword.daily.json"), join(DATA_DIR, "next", "crossword.daily.json")]) {
      // Partial publish: a day without a crossword record publishes no file.
      if (!existsSync(path)) continue;
      await expect(validateCrosswordDaily(JSON.parse(readFileSync(path, "utf-8")))).resolves.toBeTruthy();
    }
  });

  it("publishes a schema-compliant group code pilot artifact", () => {
    expect(isCodeGroupsPuzzle(publishedCodePilot)).toBe(true);
  });

  it("publishes a schema-compliant group code daily artifact when the day has one", async () => {
    const payload = readPublished(DATA_DIR, "code-groups.daily.json");
    if (payload === undefined) return;
    expect(isCodeGroupsPuzzle(payload)).toBe(true);
    expect(await verifyCodeGroupsIdentity(payload as CodeGroupsPuzzle)).toBe(payload);
  });
});

describe("published quiz manifest", () => {
  it("lists schema-compliant sessions that a client without related clues accepts", () => {
    expect(quizManifestProblems(DATA_DIR)).toEqual([]);
  });

  it("publishes an enriched manifest only when every session in it matches the legacy one but for clues", () => {
    const legacyManifest = readManifest(DATA_DIR);
    const enriched = readManifest(DATA_DIR, "manifest-v3.json");
    if (enriched === undefined) return;
    // The v3 manifest names the v2 sessions it enriches; it never comes alone.
    expect(legacyManifest).toBeDefined();
    if (legacyManifest === undefined) return;
    expect(enriched.schema_version).toBe("kpop-quiz-web-manifest-v3");
    expect(enriched.dataset_version).toBe(legacyManifest.dataset_version);
    expect(Object.keys(enriched.sessions).sort()).toEqual(Object.keys(legacyManifest.sessions).sort());
    for (const [key, entry] of Object.entries(enriched.sessions)) {
      const legacy = legacyManifest.sessions[key];
      expect(legacy, key).toBeDefined();
      if (legacy === undefined) continue;
      expect(entry.session_id, key).toBe(legacy.session_id);
      const session = readSession(DATA_DIR, entry);
      expect(isQuizSession(session), `enriched session ${key}`).toBe(true);
      const withoutClues = (value: QuizSession) => value.questions.map(({ clues_available, clues_shown, ...rest }) => rest);
      const legacySession = readSession(DATA_DIR, legacy) as QuizSession;
      expect(withoutClues(session as QuizSession), key).toEqual(withoutClues(legacySession));
      if ((session as QuizSession).config.play_mode === "expert") expect(session).toEqual(legacySession);
    }
  });
});

// A day may go out without any one of its games. These checks must accept
// such a day and still refuse a published file that is broken.
describe("published day without one of its games", () => {
  const GAME_FILES: Record<string, readonly string[]> = {
    quiz: ["manifest-v2.json", "manifest-v3.json", "session.pt-BR.json", "session.en.json"],
    connections: ["connections.daily.json"],
    "name-guess": ["name-guess.daily.json"],
    "word-search": ["word-search.daily.json"],
    timeline: ["timeline.daily.json"],
  };
  let copy: string | undefined;
  afterEach(() => {
    if (copy !== undefined) rmSync(copy, { recursive: true, force: true });
    copy = undefined;
  });

  it.each(Object.entries(GAME_FILES))("accepts a day without %s", (_game, names) => {
    copy = mkdtempSync(join(tmpdir(), "published-day-"));
    cpSync(DATA_DIR, copy, { recursive: true });
    for (const name of names) rmSync(join(copy, name), { force: true });
    expect(invalidDailyBoards(copy)).toEqual([]);
    expect(quizManifestProblems(copy)).toEqual([]);
  });

  it("still refuses a broken board or session that is published", () => {
    copy = mkdtempSync(join(tmpdir(), "published-day-"));
    writeFileSync(join(copy, "word-search.daily.json"), JSON.stringify({ schema_version: "broken" }));
    expect(invalidDailyBoards(copy)).toEqual(["word-search.daily.json"]);
    const session = "session.en.standard.broken.json";
    writeFileSync(join(copy, session), JSON.stringify({ questions: [] }));
    writeFileSync(join(copy, "manifest-v2.json"), JSON.stringify({
      schema_version: "kpop-quiz-web-manifest-v2",
      dataset_version: "0".repeat(64),
      sessions: { "en.standard": { path: session, sha256: "0".repeat(64), session_id: "0".repeat(64) } },
    }));
    expect(quizManifestProblems(copy)).toEqual([`session en.standard (${session})`]);
  });
});

describe("published question catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCatalogCache();
  });

  // The catalog is published only when the daily run is asked for it. A catalog
  // that is there must be one the consumer accepts for every language and mode,
  // and it must agree with the sessions of the same dataset.
  it("is accepted by the consumer for every language and play mode when published", async () => {
    const manifestPath = join(DATA_DIR, "catalog-manifest-v1.json");
    if (!existsSync(manifestPath)) return;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const file = join(DATA_DIR, url.split("/data/")[1]!);
      return existsSync(file) ? new Response(readFileSync(file)) : new Response(null, { status: 404 });
    }));
    for (const locale of ["pt-BR", "en"] as const) {
      for (const mode of ["assisted", "standard", "expert"] as const) {
        const catalog = await loadQuizCatalog(locale, mode, "/");
        expect(catalog.questions.length, `${locale}.${mode}`).toBeGreaterThan(0);
        // A day published without the quiz has no manifest to compare with.
        const manifest = readManifest(DATA_DIR);
        if (manifest === undefined || catalog.datasetVersion !== manifest.dataset_version) continue;
        const ids = new Set(catalog.questions.map((question) => question.id));
        const entry = manifest.sessions[`${locale}.${mode}`];
        expect(entry, `${locale}.${mode}`).toBeDefined();
        if (entry === undefined) continue;
        const session = readSession(DATA_DIR, entry) as QuizSession;
        for (const question of session.questions) expect(ids.has(question.id), `${locale}.${mode}: ${question.id}`).toBe(true);
      }
    }
  });
});
