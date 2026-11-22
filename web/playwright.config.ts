import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { isRemoteUrl, LOCAL_BUILD_TAG } from "./e2e/target";

const DEFAULT_BASE_URL = "http://127.0.0.1:4321";
const baseURL = process.env.BASE_URL?.trim() || DEFAULT_BASE_URL;

function localeReadyPath(pathname: string): string {
  const prefix = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${prefix}pt-br/`.replace(/\/{2,}/g, "/");
}

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
      readyUrl: `${origin}${localeReadyPath(parsed.pathname)}`,
    };
  } catch {
    const fallback = new URL(DEFAULT_BASE_URL);
    const origin = `${fallback.protocol}//${fallback.hostname}:${fallback.port}`;
    return {
      host: fallback.hostname,
      port: Number(fallback.port),
      url: origin,
      readyUrl: `${origin}${localeReadyPath(fallback.pathname)}`,
    };
  }
}

const remote = isRemoteUrl(baseURL);

const CI_MAX_WORKERS = 4;
const workers = remote ? 1 : process.env.CI ? Math.max(1, Math.min(availableParallelism(), CI_MAX_WORKERS)) : 1;

const localTarget = remote ? null : localPreviewTarget(baseURL);

const limits = remote
  ? { globalTimeout: 20 * 60_000, maxFailures: 3, actionTimeout: 10_000, navigationTimeout: 20_000 }
  : { globalTimeout: process.env.CI ? 35 * 60_000 : 0, maxFailures: process.env.CI ? 10 : 0, actionTimeout: 15_000, navigationTimeout: 30_000 };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers,
  globalTimeout: limits.globalTimeout,
  maxFailures: limits.maxFailures,
  ...(remote ? { grepInvert: new RegExp(LOCAL_BUILD_TAG) } : {}),
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
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
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
  ...(localTarget
    ? {
        webServer: {
          command: `npx astro preview --ignore-lock --host ${localTarget.host} --port ${localTarget.port}`,
          url: localTarget.readyUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
});
