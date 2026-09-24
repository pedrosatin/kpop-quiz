import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES = [
  join(import.meta.dirname, "../pages/pt-br/privacidade.astro"),
  join(import.meta.dirname, "../pages/en/privacy.astro"),
];

describe("privacy notice", () => {
  it("publishes a bilingual notice with the contact and consent controls", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("email@pedrosatin.com");
      expect(source).toContain("Google Analytics");
      expect(source).toContain("Cloudflare");
      expect(source).toContain("indexable={false}");
      expect(source).toContain('id="privacy-notice"');
    }
  });
});
