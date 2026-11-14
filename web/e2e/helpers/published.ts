import type { APIRequestContext, Page } from "@playwright/test";
import { test } from "@playwright/test";
import { joinBaseUrl } from "../../src/lib/join-base-url";

/**
 * Whether the site serves `file` under data/. A static host answers a missing
 * file with 404, or with an HTML page where it rewrites unknown paths.
 */
export async function isPublished(request: APIRequestContext, baseURL: string, file: string): Promise<boolean> {
  const response = await request.get(joinBaseUrl(baseURL, `/data/${file}`));
  return response.ok() && !(response.headers()["content-type"] ?? "").startsWith("text/html");
}

/**
 * Skips the running test when the day was published without any of `files`.
 * The partial publish policy may leave any daily game out of a day; the
 * smoke test (smoke.spec.ts) then checks that the page shows the missing
 * state, and a test that plays the published board has nothing to play.
 */
export async function skipUnlessPublished(page: Page, baseURL: string, ...files: [string, ...string[]]): Promise<void> {
  for (const file of files) {
    if (await isPublished(page.request, baseURL, file)) return;
  }
  test.skip(true, `the day was published without data/${files.join(" or data/")}`);
}
