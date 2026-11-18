import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILDS_DIR_ENV } from "./fixtures/site-builds";

/**
 * Creates the run directory shared by the fixture builds (fixtures/site-builds.ts)
 * and removes it once every worker is done. It builds nothing: the builds run
 * on demand, so a run whose tests use no fixture build stays without one.
 * Workers inherit the variable set here.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Astro moves assets by rename, so output must share the source filesystem.
  const scratch = fileURLToPath(new URL("../../.scratch", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, "e2e-site-builds-"));
  process.env[BUILDS_DIR_ENV] = dir;
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}
