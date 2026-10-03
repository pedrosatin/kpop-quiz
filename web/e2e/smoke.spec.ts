import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";
import { SMOKE_ROUTES } from "./fixtures/routes";
import { bootRoute } from "./helpers/boot";

test.describe("route smoke", () => {
  // Boot waits can use up to ~30s for setup/board; keep headroom over that.
  test.describe.configure({ timeout: 60_000 });

  for (const route of SMOKE_ROUTES) {
    test(`${route.path} (${route.kind}) boots`, async ({ page, baseURL }) => {
      expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

      // Absolute URL so subdirectory bases (GitHub Pages /kpop-quiz/) are kept.
      const url = joinBaseUrl(baseURL!, route.path);
      const response = await page.goto(url);
      expect(response, "navigation must return a response").not.toBeNull();
      expect(response!.ok(), `expected OK for ${url}, got ${response!.status()}`).toBeTruthy();

      await bootRoute(page, route);
    });
  }
});
