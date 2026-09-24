import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the ADR 017 dual setup: Google Analytics 4 loads only
// in non-staging builds with an ID present, and only after explicit consent.
// These assertions pin the gate in the layout source, the consent component,
// and the staging workflow so a refactor cannot silently leak GA4 into the
// ASTRO_BASE=/kpop-quiz build or load it without consent.
const LAYOUT_PATH = join(import.meta.dirname, "../layouts/BaseLayout.astro");
const CONSENT_PATH = join(import.meta.dirname, "../components/Consent/ConsentBanner.tsx");
const STAGING_WORKFLOW_PATH = join(
  import.meta.dirname,
  "../../../.github/workflows/staging.yml"
);

describe("GA4 consent gate", () => {
  it("reads the measurement ID from PUBLIC_GA4_ID", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).toContain("PUBLIC_GA4_ID");
  });

  it("mounts the consent banner only when the build is not staging", () => {
    const source = readFileSync(LAYOUT_PATH, "utf8");
    expect(source).toMatch(/!\s*isStaging\s*&&/);
    expect(source).toMatch(/enableGa4\s*&&/);
  });

  it("contains no hardcoded GA4 measurement ID", () => {
    const layout = readFileSync(LAYOUT_PATH, "utf8");
    expect(layout).not.toMatch(/G-[A-Z0-9]{6,}/);
    const consent = readFileSync(CONSENT_PATH, "utf8");
    expect(consent).not.toMatch(/G-[A-Z0-9]{6,}/);
  });

  it("loads GA4 scripts only after an explicit stored acceptance", () => {
    const source = readFileSync(CONSENT_PATH, "utf8");
    expect(source).toContain("googletagmanager.com/gtag/js");
    expect(source).toContain('"accepted"');
    expect(source).toContain("kpop-quiz-consent");
    expect(source).toContain("ga-disable-");
    expect(source).toContain("OPEN_CONSENT_PREFERENCES_EVENT");
  });

  it("guards the staging build against Google hosts", () => {
    const workflow = readFileSync(STAGING_WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("googletagmanager.com");
  });
});
