import { joinBaseUrl } from "../src/lib/join-base-url";
import { test, expect } from "./fixtures/consent";
import { SMOKE_ROUTES } from "./fixtures/routes";
import { bootRoute } from "./helpers/boot";
import { isPublished } from "./helpers/published";
import { crosswordDaily, routeCrosswordDaily } from "./helpers/crossword-daily";

function isCloudflareProduction(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname === "kpopquiz.online";
  } catch {
    return false;
  }
}

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

      await bootRoute(page, route, baseURL!);
    });
  }
});

test.describe("root redirect", () => {
  test("production sends / to /pt-br/ with 301 and keeps the query string", async ({ request, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();
    test.skip(!isCloudflareProduction(baseURL!), "Pages _redirects apply only on Cloudflare Pages production");

    const resolveLocation = (response: { status: () => number; headers: () => Record<string, string> }, label: string) => {
      expect(response.status(), `${label}: expected 301 redirect from /`).toBe(301);
      const raw = response.headers().location;
      expect(raw, `${label}: Location header missing on 301`).toBeTruthy();
      const resolved = new URL(raw!, baseURL!);
      expect(resolved.origin, `${label}: redirect must stay on ${new URL(baseURL!).origin}`).toBe(new URL(baseURL!).origin);
      return resolved;
    };

    const bare = await request.get(baseURL!, { maxRedirects: 0 });
    const bareLocation = resolveLocation(bare, "root without query");
    expect(bareLocation.pathname).toBe("/pt-br/");
    expect(bareLocation.search).toBe("");

    const withQuery = await request.get(`${baseURL!.replace(/\/$/, "")}/?s=quiz&utm_source=smoke`, {
      maxRedirects: 0,
    });
    const location = resolveLocation(withQuery, "root with query");
    expect(location.pathname).toBe("/pt-br/");
    expect(location.searchParams.get("s")).toBe("quiz");
    expect(location.searchParams.get("utm_source")).toBe("smoke");
  });

  test("local preview has no root index page", async ({ request, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();
    test.skip(isCloudflareProduction(baseURL!), "local/staging only: production answers 301 instead of 404");
    // Staging uses a subdirectory base; its "root" is /kpop-quiz/, which has
    // no index after ADR 044 and is noindex as a whole.
    const response = await request.get(joinBaseUrl(baseURL!, "/"), { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  });
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

test.describe("daily artifact boot contract", () => {
  const route = SMOKE_ROUTES.find((r) => r.path === "/pt-br/conexoes/")!;

  test("never accepts a page whose state disagrees with what the day published", async ({ page, baseURL }) => {
    const published = await isPublished(page.request, baseURL!, "connections.daily.json");
    // Published file: a page that reports it missing fails the boot. Day
    // without the file: an invalid state is not the missing one.
    await page.route("**/data/connections.daily.json", (r) => published
      ? r.fulfill({ status: 404, body: "" })
      : r.fulfill({ json: { schema_version: "broken" } }));
    await page.goto(joinBaseUrl(baseURL!, route.path));
    const state = page.getByTestId("game-missing");
    await expect(state).toHaveAttribute("data-error-kind", published ? "missing" : "invalid");
    if (published) {
      // The page has settled on the missing state, so the board the boot
      // requires will not come: refuse it in 1s, not after the boot's 30s.
      await expect(bootRoute(page, route, baseURL!, { boardTimeoutMs: 1_000 })).rejects.toThrow(/game-board/);
    } else {
      // The boot finds the missing state at once and refuses its kind.
      await expect(bootRoute(page, route, baseURL!)).rejects.toThrow(/data-error-kind/);
    }
  });
});
