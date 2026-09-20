import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isConnectionsPuzzle,
  isIntersectionGrid,
  isNameGuessPuzzle,
  isQuizSession,
} from "../lib/quiz-types";
import { isWordSearchPuzzle } from "../lib/word-search-types";
import publishedConnections from "../../public/data/connections.daily.json";
import publishedGrid from "../../public/data/grid.daily.json";
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

  it("publishes a schema-compliant intersection grid", () => {
    expect(isIntersectionGrid(publishedGrid)).toBe(true);
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
