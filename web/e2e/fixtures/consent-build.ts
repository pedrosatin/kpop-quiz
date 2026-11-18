import { test as base } from "@playwright/test";
import { CONSENT_BUILD, SITE_BUILD_FIXTURE_TIMEOUT_MS, serveSiteBuild } from "./site-builds";

/**
 * The consent banner only renders when a GA4 id is built in, which the
 * default dist leaves out. This worker fixture serves the shared build that
 * has one (site-builds.ts), independently of BASE_URL, on a free port and
 * blocks every other origin, so no test reaches Google or Cloudflare.
 */
export const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => serveSiteBuild(CONSENT_BUILD, use), { scope: "worker", timeout: SITE_BUILD_FIXTURE_TIMEOUT_MS }],
});

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, consentURL }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL
    ? route.continue()
    : route.abort());
});

export { expect } from "@playwright/test";
