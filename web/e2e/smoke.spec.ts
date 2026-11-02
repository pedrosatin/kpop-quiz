import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";
import { SMOKE_ROUTES } from "./fixtures/routes";
import { bootRoute } from "./helpers/boot";
import { crosswordDaily, routeCrosswordDaily } from "./helpers/crossword-daily";

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

test.describe("crossword boot contract", () => {
  const route = SMOKE_ROUTES.find((r) => r.path === "/pt-br/cruzadinha/")!;

  test("requires the board when today's envelope is served", async ({ page, baseURL }) => {
    await routeCrosswordDaily(page);
    await page.goto(joinBaseUrl(baseURL!, route.path));
    await bootRoute(page, route);
    await expect(page.getByTestId("game-board")).toBeVisible();
  });

  test("fails on an invalid artifact instead of accepting the empty-day state", async ({ page, baseURL }) => {
    const daily = await crosswordDaily();
    await page.route("**/data/next/crossword.daily.json", (r) => r.fulfill({ status: 404, body: "" }));
    await page.route("**/data/crossword.daily.json", (r) => r.fulfill({ json: { ...daily, attempts: 2 } }));
    await page.goto(joinBaseUrl(baseURL!, route.path));
    await expect(bootRoute(page, route)).rejects.toThrow(/unexpected missing state "invalid"/);
  });
});
