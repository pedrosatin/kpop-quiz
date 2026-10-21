import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const redirects = readFileSync(join(import.meta.dirname, "../../public/_redirects"), "utf-8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length === 3 && !parts[0]!.startsWith("#"));

describe("_redirects", () => {
  it.each([
    ["/pt-br/cruzadinha-piloto/", "/pt-br/cruzadinha/"],
    ["/en/crossword-pilot/", "/en/crossword/"],
  ])("sends the old crossword pilot route %s to %s with a 301", (from, to) => {
    expect(redirects).toContainEqual([from, to, "301"]);
  });
});
