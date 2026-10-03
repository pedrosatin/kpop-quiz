import { defineConfig, devices } from "@playwright/test";

const DEFAULT_BASE_URL = "http://127.0.0.1:4321";
const baseURL = process.env.BASE_URL?.trim() || DEFAULT_BASE_URL;

function isRemoteUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname !== "127.0.0.1" && hostname !== "localhost";
  } catch {
    return false;
  }
}

/** Host/port for local astro preview; fall back to DEFAULT_BASE_URL if parsing fails. */
function localPreviewTarget(url: string): { host: string; port: number; url: string } {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("not local");
    }
    const port = parsed.port ? Number(parsed.port) : 4321;
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("invalid port");
    }
    return {
      host: parsed.hostname,
      port,
      url: `${parsed.protocol}//${parsed.hostname}:${port}`,
    };
  } catch {
    const fallback = new URL(DEFAULT_BASE_URL);
    return {
      host: fallback.hostname,
      port: Number(fallback.port),
      url: DEFAULT_BASE_URL,
    };
  }
}

const remote = isRemoteUrl(baseURL);
const localTarget = remote ? null : localPreviewTarget(baseURL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: localTarget?.url ?? baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // chromium is the PR/deploy gate; firefox + webkit are selected by the nightly script.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
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
          command: `npx astro preview --host ${localTarget.host} --port ${localTarget.port}`,
          url: localTarget.url,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
});
