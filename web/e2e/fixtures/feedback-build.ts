import { test as base } from "@playwright/test";
import { FEEDBACK_BUILD, SITE_BUILD_FIXTURE_TIMEOUT_MS, serveSiteBuild } from "./site-builds";

/** An isolated rating build with analytics disabled and external requests blocked. */
export const test = base.extend<{}, { feedbackURL: string }>({
  feedbackURL: [async ({}, use) => serveSiteBuild(FEEDBACK_BUILD, use), { scope: "worker", timeout: SITE_BUILD_FIXTURE_TIMEOUT_MS }],
});

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, feedbackURL }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === feedbackURL
    ? route.continue()
    : route.abort());
});

export { expect } from "@playwright/test";
