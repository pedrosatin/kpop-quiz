import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isHttpsUrl, parseHttpsUrl } from "./https-url";

const SRC = join(import.meta.dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|astro)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield path;
  }
}

describe("isHttpsUrl", () => {
  it.each([
    "https://en.wikipedia.org/w/index.php?curid=1&oldid=2",
    "https://musicbrainz.org/event/0f5f2c9e-1d3a-4b6f-9a8e-2b7f4c1d0e11",
    "https://creativecommons.org/licenses/by/3.0/",
  ])("accepts %s", (url) => {
    expect(isHttpsUrl(url)).toBe(true);
  });

  // "https://" and "https://exa mple.com" pass a startsWith("https://") prefix
  // test but do not parse as a URL with a host.
  it.each([
    "https://",
    "https://exa mple.com/",
    "http://musicbrainz.org/event/1",
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.example/",
    "",
    "not a url",
  ])("rejects %j", (url) => {
    expect(isHttpsUrl(url)).toBe(false);
    expect(parseHttpsUrl(url)).toBeNull();
  });

  it("rejects values that are not strings", () => {
    for (const value of [null, undefined, 42, {}, ["https://example.com/"]]) {
      expect(isHttpsUrl(value)).toBe(false);
    }
  });

  it("is the only https check in the web source", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith("https-url.ts")) continue;
      const source = readFileSync(file, "utf8");
      if (/startsWith\(\s*["'`]https?:/.test(source) || /function\s+isHttp/.test(source) || /protocol\s*[!=]==\s*["']https?:/.test(source)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
