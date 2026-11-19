import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const redirects = readFileSync(join(import.meta.dirname, "../../public/_redirects"), "utf-8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length === 3 && !parts[0]!.startsWith("#"));

describe("_redirects", () => {
  it("sends the domain root to /pt-br/ with a 301", () => {
    expect(redirects).toContainEqual(["/", "/pt-br/", "301"]);
  });

  it.each([
    ["/pt-br/codigo-piloto/", "/pt-br/codigo/"],
    ["/en/code-pilot/", "/en/code/"],
    ["/pt-br/cruzadinha-piloto/", "/pt-br/cruzadinha/"],
    ["/en/crossword-pilot/", "/en/crossword/"],
  ])("sends the old pilot route %s to %s with a 301", (from, to) => {
    expect(redirects).toContainEqual([from, to, "301"]);
  });
});
