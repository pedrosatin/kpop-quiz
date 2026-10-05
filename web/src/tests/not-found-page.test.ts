import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(import.meta.dirname, "../pages/404.astro");

describe("404 page", () => {
  it("stays out of the index and links to every game in both languages", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("indexable={false}");
    expect(source).not.toContain("canonicalPath");
    expect(source).toContain('id="not-found"');
    for (const path of [
      "/pt-br/",
      "/pt-br/grid/",
      "/pt-br/conexoes/",
      "/pt-br/adivinhe/",
      "/pt-br/caca-palavras/",
      "/pt-br/mapa/",
      "/pt-br/linha-do-tempo/",
      "/en/",
      "/en/grid/",
      "/en/connections/",
      "/en/guess/",
      "/en/word-search/",
      "/en/map/",
      "/en/timeline/",
    ]) {
      expect(source).toContain(`path: "${path}"`);
    }
  });
});
