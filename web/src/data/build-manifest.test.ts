import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialQuizDecades } from "./build-manifest";
import { availableDecadesFromManifest } from "./session-loader";

const DECADES = [1990, 2000, 2010, 2020];

describe("build-time quiz decades", () => {
  it("reads decades from the published manifest", () => {
    expect(initialQuizDecades().length).toBeGreaterThan(0);
  });

  it("returns a subset of the known decades for the published manifest", () => {
    const file = path.resolve(process.cwd(), "public/data/manifest-v2.json");
    const decades = availableDecadesFromManifest(JSON.parse(fs.readFileSync(file, "utf-8")));
    expect(decades.length).toBeGreaterThan(0);
    for (const decade of decades) expect(DECADES).toContain(decade);
  });

  it("returns no decades for a value that is not a manifest", () => {
    expect(availableDecadesFromManifest({ sessions: "none" })).toEqual([]);
    expect(availableDecadesFromManifest(null)).toEqual([]);
    expect(availableDecadesFromManifest("manifest")).toEqual([]);
  });
});
