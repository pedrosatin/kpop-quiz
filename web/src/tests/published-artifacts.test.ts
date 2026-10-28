import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isConnectionsPuzzle,
  isIntersectionGrid,
  isNameGuessPuzzle,
  isQuizSession,
  type QuizSession,
} from "../lib/quiz-types";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import {
  isCodeGroupsPuzzle,
  verifyCodeGroupsIdentity,
  type CodeGroupsPuzzle,
} from "../data/code-groups";
import { validateCrosswordPuzzle } from "../data/crossword";
import publishedConnections from "../../public/data/connections.daily.json";
import publishedCrossword from "../../public/data/crossword-pilot.json";
import publishedCodePilot from "../../public/data/code-groups.pilot.json";
import publishedNameGuess from "../../public/data/name-guess.daily.json";
import publishedWordSearch from "../../public/data/word-search.daily.json";
import publishedManifest from "../../public/data/manifest-v2.json";

// Behavioural tests read frozen copies under src/tests/fixtures so the suite does
// not break every time the daily cron regenerates the artifacts. These checks stay
// pointed at the real published files, asserting schema compliance only.
describe("published daily artifacts", () => {
  it("publishes a schema-compliant connections puzzle", () => {
    expect(isConnectionsPuzzle(publishedConnections)).toBe(true);
  });

  it("publishes the audited crossword board", async () => {
    await expect(validateCrosswordPuzzle(structuredClone(publishedCrossword))).resolves.toBeTruthy();
  });

  it("publishes a schema-compliant group code pilot artifact", () => {
    expect(isCodeGroupsPuzzle(publishedCodePilot)).toBe(true);
  });

  it("publishes a schema-compliant group code daily artifact when the day has one", async () => {
    const path = join(DATA_DIR, "code-groups.daily.json");
    if (!existsSync(path)) {
      // Partial publish: a generation failure leaves the day without the
      // file, and the code page reports the artifact as missing.
      return;
    }
    const payload: unknown = JSON.parse(readFileSync(path, "utf-8"));
    expect(isCodeGroupsPuzzle(payload)).toBe(true);
    expect(await verifyCodeGroupsIdentity(payload as CodeGroupsPuzzle)).toBe(payload);
  });

  it("publishes a schema-compliant intersection grid when the artifact is present", () => {
    const gridPath = join(DATA_DIR, "grid.daily.json");
    if (!existsSync(gridPath)) {
      // A daily set publishes without grid.daily.json when the fill fails and
      // no valid previous grid exists; the grid page reports the artifact as
      // missing. The static import is avoided for the same reason.
      return;
    }
    expect(isIntersectionGrid(JSON.parse(readFileSync(gridPath, "utf-8")))).toBe(true);
  });

  it("publishes a schema-compliant name guess puzzle", () => {
    expect(isNameGuessPuzzle(publishedNameGuess)).toBe(true);
  });

  it("publishes a schema-compliant word search puzzle", () => {
    expect(isWordSearchPuzzle(publishedWordSearch)).toBe(true);
  });
});

const DATA_DIR = join(import.meta.dirname, "../../public/data");

describe("published quiz manifest", () => {
  it("declares the expected manifest schema", () => {
    expect(publishedManifest.schema_version).toBe("kpop-quiz-web-manifest-v2");
  });

  it("resolves every declared session to a schema-compliant payload", () => {
    const entries = Object.entries(publishedManifest.sessions);
    expect(entries.length).toBeGreaterThan(0);

    for (const [key, entry] of entries) {
      const raw = readFileSync(join(DATA_DIR, entry.path), "utf-8");
      expect(isQuizSession(JSON.parse(raw)), `session ${key} (${entry.path})`).toBe(true);
    }
  });

  // A client released before related clues existed rejects any session whose
  // clue cites a fact outside its question, and it reads this manifest on every
  // game. The check is that client's own rule, applied to what is published.
  it("lists only sessions a client without related clues accepts", () => {
    for (const [key, entry] of Object.entries(publishedManifest.sessions)) {
      const session = JSON.parse(readFileSync(join(DATA_DIR, entry.path), "utf-8")) as QuizSession;
      for (const question of session.questions) {
        for (const clue of question.clues_available) {
          expect(
            clue.fact_base_ids.every((id) => question.fact_base_ids.includes(id)),
            `session ${key}: clue ${clue.id} cites a fact outside its question`,
          ).toBe(true);
        }
      }
    }
  });

  it("publishes an enriched manifest only when every session in it matches the legacy one but for clues", () => {
    const path = join(DATA_DIR, "manifest-v3.json");
    if (!existsSync(path)) return;
    const enriched = JSON.parse(readFileSync(path, "utf-8")) as typeof publishedManifest;
    expect(enriched.schema_version).toBe("kpop-quiz-web-manifest-v3");
    expect(enriched.dataset_version).toBe(publishedManifest.dataset_version);
    expect(Object.keys(enriched.sessions).sort()).toEqual(Object.keys(publishedManifest.sessions).sort());
    for (const [key, entry] of Object.entries(enriched.sessions)) {
      const legacy = publishedManifest.sessions[key as keyof typeof publishedManifest.sessions];
      expect(entry.session_id, key).toBe(legacy.session_id);
      const session = JSON.parse(readFileSync(join(DATA_DIR, entry.path), "utf-8")) as unknown;
      expect(isQuizSession(session), `enriched session ${key}`).toBe(true);
      const withoutClues = (value: QuizSession) => value.questions.map(({ clues_available, clues_shown, ...rest }) => rest);
      const legacySession = JSON.parse(readFileSync(join(DATA_DIR, legacy.path), "utf-8")) as QuizSession;
      expect(withoutClues(session as QuizSession), key).toEqual(withoutClues(legacySession));
      if ((session as QuizSession).config.play_mode === "expert") expect(session).toEqual(legacySession);
    }
  });
});
