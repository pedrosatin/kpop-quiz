import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isConnectionsPuzzle,
  isIntersectionGrid,
  isNameGuessPuzzle,
  isQuizSession,
} from "../lib/quiz-types";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import {
  isCodeGroupsPuzzle,
  verifyCodeGroupsIdentity,
  type CodeGroupsPuzzle,
} from "../data/code-groups";
import publishedConnections from "../../public/data/connections.daily.json";
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
});
