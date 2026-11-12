import { test as base } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preview } from "astro";

/**
 * The consent banner only renders when a GA4 id is built in, which the
 * default dist leaves out. This worker fixture builds a dist that has one,
 * independently of BASE_URL, serves it on a free port and blocks every other
 * origin, so no test reaches Google or Cloudflare.
 */
export const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const scratch = join(root, "../.scratch");
    await mkdir(scratch, { recursive: true });
    // Astro moves assets by rename, so output must share the source filesystem.
    const outDir = await mkdtemp(join(scratch, "consent-build-"));
    let server: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await promisify(execFile)(process.execPath, ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          ASTRO_BASE: "",
          BASE_URL: "/",
          PUBLIC_GA4_ID: "G-E2ECONSENT02",
          PUBLIC_CF_BEACON_TOKEN: "",
        },
        timeout: 120_000,
      });
      server = await preview({ root, outDir, base: "/", server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
      await use(`http://127.0.0.1:${server.port}`);
    } finally {
      await server?.stop();
      await rm(outDir, { recursive: true, force: true });
    }
  }, { scope: "worker", timeout: 120_000 }],
});

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, consentURL }) => {
  await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL
    ? route.continue()
    : route.abort());
});

export { expect } from "@playwright/test";
