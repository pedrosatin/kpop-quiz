import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/consent";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { joinBaseUrl } from "../src/lib/join-base-url";

/**
 * Catalog-backed general-quiz replay (Q03). The default dist has no catalog
 * (QUIZ_CATALOG off); this suite fulfills the Q02 fixtures so the browser path
 * can be exercised without publishing production data or flipping the flag.
 */

const catalogDir = fileURLToPath(new URL("../src/tests/fixtures/catalog/", import.meta.url));
const catalogFiles = Object.fromEntries(
  readdirSync(catalogDir).map((name) => [name, readFileSync(join(catalogDir, name))]),
);

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

async function fulfillCatalog(page: Page) {
  await page.route("**/data/catalog-manifest-v1.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: catalogFiles["catalog-manifest-v1.json"]!,
    }),
  );
  await page.route("**/data/catalog.*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = catalogFiles[name];
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

async function answerAll(page: Page, submit: string, next: RegExp) {
  for (let i = 0; i < 12; i += 1) {
    const board = page.getByTestId("game-board");
    await expect(board).toBeVisible();
    await board.locator("label.option").first().click();
    await board.getByRole("button", { name: submit }).click();
    const advance = board.getByRole("button", { name: next });
    await expect(advance).toBeVisible();
    await page.waitForTimeout(NEXT_GUARD_MS + 50);
    await advance.click();
    if (await page.getByTestId("game-result").isVisible()) return;
  }
  throw new Error("did not reach game-result");
}

for (const locale of [
  { id: "pt", path: "/pt-br/", start: "Começar partida", submit: "Responder", next: /Próxima pergunta|Ver resultado/, restart: "Jogar novamente", unavailable: /Não há perguntas suficientes/ },
  { id: "en", path: "/en/", start: "Start game", submit: "Submit answer", next: /Next question|See results/, restart: "Play again", unavailable: /There are not enough questions/ },
] as const) {
  for (const viewport of viewports) {
    test(`catalog replay changes the set (${locale.id}, ${viewport.name})`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await fulfillCatalog(page);
      await page.goto(joinBaseUrl(baseURL!, locale.path));
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId("game-start").click();
      const firstPrompt = (await page.getByTestId("game-board").getByRole("heading", { level: 2 }).textContent())!;
      await answerAll(page, locale.submit, locale.next);
      await expect(page.getByTestId("game-result")).toBeVisible();
      await page.getByRole("button", { name: locale.restart }).click();
      await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).not.toHaveText(firstPrompt);
    });
  }
}

test("decade filter with an empty catalog pool shows unavailability", async ({ page, baseURL }) => {
  await fulfillCatalog(page);
  await page.goto(`${joinBaseUrl(baseURL!, "/pt-br/")}?decade=1990`);
  await expect(page.getByText(/Não há perguntas suficientes/)).toBeVisible({ timeout: 30_000 });
});

test("daily theme keeps the published session and skips catalog shards", async ({ page, baseURL }) => {
  const catalogHits: string[] = [];
  await page.route("**/data/catalog**", (route) => {
    catalogHits.push(route.request().url());
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${joinBaseUrl(baseURL!, "/pt-br/")}?theme=daily`);
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  expect(catalogHits).toEqual([]);
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-board")).toBeVisible();
});

test("corrupted catalog manifest yields a clear invalid state", async ({ page, baseURL }) => {
  await page.route("**/data/catalog-manifest-v1.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ broken: true }) }),
  );
  await page.goto(joinBaseUrl(baseURL!, "/pt-br/"));
  await expect(page.getByText(/Não foi possível ler os dados deste jogo/)).toBeVisible({ timeout: 30_000 });
});
