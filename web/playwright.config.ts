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

const remote = isRemoteUrl(baseURL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Local runs serve the built dist/; remote BASE_URL (staging/prod) skips webServer.
  ...(remote
    ? {}
    : {
        webServer: {
          command: "npx astro preview --host 127.0.0.1 --port 4321",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
