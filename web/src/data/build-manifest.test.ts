import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialQuizDecades } from "./build-manifest";
import { availableDecadesFromManifest } from "./session-loader";

const DECADES = [1990, 2000, 2010, 2020];

describe("build-time quiz decades", () => {
  const file = path.resolve(process.cwd(), "public/data/manifest-v2.json");

  it("reads a subset of the known decades from the published manifest", () => {
    if (!fs.existsSync(file)) {
      // A day published without the quiz has no manifest; the build then
      // hides the decade picker until the client's own fetch.
      expect(initialQuizDecades()).toEqual([]);
      return;
    }
    expect(initialQuizDecades().length).toBeGreaterThan(0);
    const decades = availableDecadesFromManifest(JSON.parse(fs.readFileSync(file, "utf-8")));
    expect(decades).toEqual(initialQuizDecades());
    for (const decade of decades) expect(DECADES).toContain(decade);
  });

  it("returns no decades for a value that is not a manifest", () => {
    expect(availableDecadesFromManifest({ sessions: "none" })).toEqual([]);
    expect(availableDecadesFromManifest(null)).toEqual([]);
    expect(availableDecadesFromManifest("manifest")).toEqual([]);
  });
});
