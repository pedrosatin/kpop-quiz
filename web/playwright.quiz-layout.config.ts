import { defineConfig } from "@playwright/test";

// Separate fixture build: consent must be real without depending on a secret
// or replacing the normal production artifact.
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4384", hasTouch: true, screenshot: "only-on-failure" },
  webServer: {
    command: "PUBLIC_GA4_ID=G-QUIZ03TEST npx astro build --outDir .scratch/quiz-layout-dist && npx astro preview --ignore-lock --outDir .scratch/quiz-layout-dist --host 127.0.0.1 --port 4384",
    url: "http://127.0.0.1:4384/pt-br/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
