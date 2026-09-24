import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for ADR 017: the Cloudflare Web Analytics beacon must only
// ever render in non-staging builds with a token present. These assertions pin
// the gate in the layout source and in the staging workflow so a refactor
// cannot silently leak the snippet into the ASTRO_BASE=/kpop-quiz build.
const LAYOUT_PATH = join(import.meta.dirname, "../layouts/BaseLayout.astro");
const STAGING_WORKFLOW_PATH = join(
  import.meta.dirname,
  "../../../.github/workflows/staging.yml",
);

describe("analytics beacon gate", () => {
  it("reads the token from PUBLIC_CF_BEACON_TOKEN", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).toContain("PUBLIC_CF_BEACON_TOKEN");
  });

  it("renders the beacon only when the build is not staging", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).toMatch(/!\s*isStaging\s*&&/);
    expect(source).toMatch(/enableAnalytics\s*&&/);
  });

  it("points at the Cloudflare beacon host with the token in data-cf-beacon", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(source).toContain("data-cf-beacon");
  });

  it("contains no hardcoded beacon token", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).not.toMatch(/["']token["']\s*:\s*["'][0-9a-f]{8,}/i);
  });

  it("keeps the staging noindex tag and a CI guard against beacon leaks", () => {
    const layout = readFileSync(LAYOUT_PATH, "utf8");
    expect(layout).toContain('content="noindex"');
    const workflow = readFileSync(STAGING_WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("cloudflareinsights.com");
  });
});
