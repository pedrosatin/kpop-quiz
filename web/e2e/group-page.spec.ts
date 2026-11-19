import { joinBaseUrl } from "../src/lib/join-base-url";
import { expect, test } from "./fixtures/consent";

const PATHS = ["/pt-br/stray-kids/", "/en/stray-kids/"] as const;

test.describe("group landing page", () => {
  test.describe.configure({ timeout: 60_000 });

  for (const path of PATHS) {
    test(`${path} boots with copy, quiz start and word search`, async ({ page, baseURL }) => {
      expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();
      const response = await page.goto(joinBaseUrl(baseURL!, path));
      expect(response, "navigation must return a response").not.toBeNull();
      expect(response!.ok(), `expected OK for ${path}, got ${response!.status()}`).toBeTruthy();

      await expect(page.getByTestId("group-page")).toBeVisible();
      await expect(page.getByTestId("group-page-body")).toBeVisible();
      await expect(page.locator("h1")).toContainText(/K-pop/i);

      const quizStart = page.getByTestId("group-quiz-start");
      await expect(quizStart).toBeVisible({ timeout: 30_000 });
      await quizStart.getByRole("button").click();
      await expect(page.getByTestId("group-quiz").getByTestId("game-board")).toBeVisible({
        timeout: 30_000,
      });

      const wordSearch = page.getByTestId("group-word-search");
      await expect(wordSearch).toBeVisible({ timeout: 30_000 });
      await expect(wordSearch.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
    });
  }

  test("pt-br page declares reciprocal hreflang with en", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    await page.goto(joinBaseUrl(baseURL!, "/pt-br/stray-kids/"));
    const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        hreflang: node.getAttribute("hreflang"),
        href: node.getAttribute("href"),
      })),
    );
    expect(alternates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hreflang: "pt-BR", href: expect.stringContaining("/pt-br/stray-kids/") }),
        expect.objectContaining({ hreflang: "en", href: expect.stringContaining("/en/stray-kids/") }),
        expect.objectContaining({ hreflang: "x-default", href: expect.stringContaining("/en/stray-kids/") }),
      ]),
    );
  });
});
