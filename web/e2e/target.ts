/**
 * Whether the run targets a published site (production, staging) instead of
 * the local astro preview. playwright.config.ts sets up a remote run from it.
 */
export function isRemoteUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname !== "127.0.0.1" && hostname !== "localhost";
  } catch {
    return false;
  }
}

/**
 * Tag of the tests that serve a fixture build of this checkout
 * (fixtures/site-builds.ts) instead of BASE_URL. They test that build, not the
 * published site, so a remote run leaves them out and builds nothing.
 */
export const LOCAL_BUILD_TAG = "@local-build";
