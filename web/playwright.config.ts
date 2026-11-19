import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { isRemoteUrl, LOCAL_BUILD_TAG } from "./e2e/target";

const DEFAULT_BASE_URL = "http://127.0.0.1:4321";
const baseURL = process.env.BASE_URL?.trim() || DEFAULT_BASE_URL;

/** Host/port for local astro preview; fall back to DEFAULT_BASE_URL if parsing fails. */
function localPreviewTarget(url: string): { host: string; port: number; url: string; readyUrl: string } {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("not local");
    }
    const port = parsed.port ? Number(parsed.port) : 4321;
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("invalid port");
    }
    const origin = `${parsed.protocol}//${parsed.hostname}:${port}`;
    return {
      host: parsed.hostname,
      port,
      url: origin,
      // After ADR 044 the domain root is not a page (301 on Pages, 404 in
      // local preview). Probe a real route so the readiness check succeeds.
      readyUrl: `${origin}/pt-br/`,
    };
  } catch {
    const fallback = new URL(DEFAULT_BASE_URL);
    const origin = `${fallback.protocol}//${fallback.hostname}:${fallback.port}`;
    return {
      host: fallback.hostname,
      port: Number(fallback.port),
      url: origin,
      readyUrl: `${origin}/pt-br/`,
    };
  }
}

const remote = isRemoteUrl(baseURL);

/**
 * CI uses one worker per vCPU (4 on the public runners). The cap keeps a larger
 * runner from overloading the single astro preview every worker shares. Local
 * runs stay at 1 so a laptop under load does not turn into timeouts; pass
 * --workers to change it. A remote target (the production and staging smokes)
 * always gets 1, so a CI run does not hit the live site with several browsers.
 */
const CI_MAX_WORKERS = 4;
const workers = remote ? 1 : process.env.CI ? Math.max(1, Math.min(availableParallelism(), CI_MAX_WORKERS)) : 1;

const localTarget = remote ? null : localPreviewTarget(baseURL);

/**
 * Time limits, so a regression fails early instead of spending the job's
 * timeout. A remote run (the post-deploy smokes, about 10 minutes on a healthy
 * day) talks to a CDN: an action or a page load that stalls there is broken,
 * not slow. The local preview runs on a loaded runner with several workers,
 * so its limits leave more room, and a laptop run (no CI) has no global limit.
 * None of these replaces the longer waits a test sets itself (the playthrough
 * and boot smoke budgets, the boot's 30s for setup and board): those are
 * expect timeouts and test timeouts, which these do not touch.
 */
const limits = remote
  ? { globalTimeout: 20 * 60_000, maxFailures: 3, actionTimeout: 10_000, navigationTimeout: 20_000 }
  : { globalTimeout: process.env.CI ? 35 * 60_000 : 0, maxFailures: process.env.CI ? 10 : 0, actionTimeout: 15_000, navigationTimeout: 30_000 };

export default defineConfig({
  testDir: "./e2e",
  // Files run in parallel with each other; tests inside a file stay in order
  // unless the file opts in with test.describe.configure({ mode: "parallel" }).
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers,
  globalTimeout: limits.globalTimeout,
  maxFailures: limits.maxFailures,
  // Tests that serve a fixture build of this checkout say nothing about a
  // published site; a remote run skips them and builds no fixture (e2e/target.ts).
  ...(remote ? { grepInvert: new RegExp(LOCAL_BUILD_TAG) } : {}),
  // Fixture site builds (e2e/fixtures/site-builds.ts) share one directory per run.
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: {
    baseURL: localTarget?.url ?? baseURL,
    bypassCSP: true,
    actionTimeout: limits.actionTimeout,
    navigationTimeout: limits.navigationTimeout,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // chromium is the PR/deploy gate; firefox + webkit are selected by the nightly script.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The deploy gate and the production smoke run builds that carry the real
        // beacon token. Without this, every run is counted as a visit in Web Analytics.
        launchOptions: { args: ["--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND"] },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // Local runs serve the built dist/; remote BASE_URL (staging/prod) skips webServer.
  ...(localTarget
    ? {
        webServer: {
          // Keep the server in the foreground so Playwright owns its lifetime.
          command: `npx astro preview --ignore-lock --host ${localTarget.host} --port ${localTarget.port}`,
          url: localTarget.readyUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
});
