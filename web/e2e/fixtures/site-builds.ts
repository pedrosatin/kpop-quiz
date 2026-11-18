import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preview } from "astro";

/**
 * Site builds the fixtures serve: a variant of the site that the default dist/
 * cannot stand in for (a GA4 id built in, a rating key, a different dataset).
 *
 * Each build runs at most once per Playwright run, and only when a selected
 * test asks for it: a run that selects no test using a fixture (the boot smoke,
 * the nightly) builds nothing. The output lives in the run directory that
 * global-setup.ts creates and global-teardown removes, so workers and retries
 * reuse it. Builds are serialized by a lock across workers, because two
 * `astro build` at once fight over web/.astro/ and fail with
 * "Cannot find module '.../web/.astro/.prerender/...'".
 *
 * A build is read only once it is ready. Anything that changes files after the
 * build (removing a manifest, swapping data/) goes in `after`, inside the
 * build's own directory, and a variant of another build copies it with `from`.
 */
export type SiteBuild = {
  /** Directory name under the run directory; one per configuration. */
  name: string;
  /** Environment of `astro build`. Ignored when `from` is set. */
  env?: Record<string, string>;
  /** Start from a copy of this build instead of building. */
  from?: SiteBuild;
  /** Changes the output before it is shared. */
  after?: (outDir: string) => Promise<void>;
};

export const BUILDS_DIR_ENV = "E2E_SITE_BUILDS_DIR";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));

const productionEnv = {
  NODE_ENV: "production",
  ASTRO_BASE: "",
  BASE_URL: "/",
  PUBLIC_CF_BEACON_TOKEN: "",
};

/**
 * The real consent banner only renders when a GA4 id is built in, which the
 * default dist leaves out. No test reads the id itself.
 */
export const CONSENT_BUILD: SiteBuild = {
  name: "consent",
  env: { ...productionEnv, PUBLIC_GA4_ID: "G-E2ECONSENT" },
};

/** A rating build with analytics off, also when publication omits the quiz. */
export const FEEDBACK_BUILD: SiteBuild = {
  name: "feedback",
  env: { ...productionEnv, PUBLIC_GA4_ID: "", PUBLIC_TBBC_SITE_KEY: "k_test" },
  after: async (outDir) => {
    await Promise.all(["manifest-v2.json", "manifest-v3.json"].map((name) =>
      rm(join(outDir, "data", name), { force: true })));
  },
};

const BUILD_TIMEOUT_MS = 180_000;
const LOCK_POLL_MS = 200;

/** Worker fixtures that may wait for other builds before their own. */
export const SITE_BUILD_FIXTURE_TIMEOUT_MS = 300_000;

const ready = new Map<string, Promise<string>>();

function buildsDir(): string {
  const dir = process.env[BUILDS_DIR_ENV];
  if (!dir) throw new Error(`${BUILDS_DIR_ENV} is unset; e2e/global-setup.ts creates it`);
  return dir;
}

/** Returns the output directory of `build`, building it first if no worker has. */
export function ensureSiteBuild(build: SiteBuild): Promise<string> {
  let pending = ready.get(build.name);
  if (!pending) {
    pending = produce(build);
    pending.catch(() => ready.delete(build.name));
    ready.set(build.name, pending);
  }
  return pending;
}

async function produce(build: SiteBuild): Promise<string> {
  const base = build.from ? await ensureSiteBuild(build.from) : undefined;
  const dir = buildsDir();
  const outDir = join(dir, build.name);
  const marker = `${outDir}.ready`;
  return withLock(dir, async () => {
    if (await exists(marker)) return outDir;
    await rm(outDir, { recursive: true, force: true });
    const started = Date.now();
    try {
      if (base) {
        await cp(base, outDir, { recursive: true });
      } else {
        // Astro moves assets by rename, so output must share the source filesystem.
        await promisify(execFile)(process.execPath, ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
          cwd: webRoot,
          env: { ...process.env, ...build.env },
          timeout: BUILD_TIMEOUT_MS,
        });
      }
      await build.after?.(outDir);
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
    await writeFile(marker, "");
    const how = base ? `copied from ${build.from!.name}` : "astro build";
    console.log(`[e2e site build] ${build.name}: ${how} in ${((Date.now() - started) / 1000).toFixed(1)}s (pid ${process.pid})`);
    return outDir;
  });
}

/** Serves `build` on a free port for the lifetime of a worker fixture. */
export async function serveSiteBuild(build: SiteBuild, use: (url: string) => Promise<void>): Promise<void> {
  const outDir = await ensureSiteBuild(build);
  const server = await preview({ root: webRoot, outDir, base: "/", server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  try {
    await use(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.stop();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** mkdir is atomic: the worker that creates the directory holds the lock. */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(dir, ".lock");
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await holderDied(lock)) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid));
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** A worker killed mid-build (a timeout, a crash) must not block the others. */
async function holderDied(lock: string): Promise<boolean> {
  let pid: number;
  try {
    pid = Number(await readFile(join(lock, "pid"), "utf8"));
  } catch {
    return false; // Just taken; the holder has not written its pid yet.
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
