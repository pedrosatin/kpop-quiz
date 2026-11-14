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

  it("names tbbc.app as the recipient of the post-game feedback", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("<code>tbbc.app</code>");
      expect(source).toContain("TBBC");
      expect(source).toMatch(/IP/);
    }
  });

  it("names every host the CSP lets the page connect to", () => {
    const headers = readFileSync(join(import.meta.dirname, "../../public/_headers"), "utf8");
    const connectSrc = /connect-src([^;]*)/.exec(headers)![1]!.trim().split(/\s+/);
    const thirdParties = connectSrc.filter((source) => source !== "'self'").map((source) => new URL(source.replace("*.", "")).hostname);
    const named: Record<string, string> = {
      "tbbc.app": "tbbc.app",
      "cloudflareinsights.com": "Cloudflare",
      "google-analytics.com": "Google Analytics",
      "analytics.google.com": "Google Analytics",
      "googletagmanager.com": "Google Analytics",
    };
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      for (const host of thirdParties) {
        expect(named[host], `connect-src host ${host} has no entry in this test`).toBeDefined();
        expect(source, `${page} does not name ${host}`).toContain(named[host]!);
      }
    }
  });
});
