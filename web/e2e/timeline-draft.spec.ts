import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
import { expectBoardDirectReady } from "./helpers/boot";
import { reloadPersisted } from "./helpers/passive-effects";
import { gamePlayed } from "./helpers/player-stats";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const locales = [
  { id: "pt", path: "/pt-br/linha-do-tempo/", up: /para cima$/, submit: "Verificar ordem", position: "Sua posição: 4" },
  { id: "en", path: "/en/timeline/", up: /up$/, submit: "Check order", position: "Your position: 4" },
] as const;

function cardTitles(page: Page): Promise<string[]> {
  return page.locator(".timeline-card .timeline-card-title").allTextContents();
}

for (const locale of locales) {
  test(`timeline keeps the order built before a reload and shows it in the result (${locale.id})`, async ({ page }) => {
    await page.goto(`${base}${locale.path}`);
    await expectBoardDirectReady(page);
    const opening = await cardTitles(page);
    expect(opening).toHaveLength(5);

    await page.locator(".timeline-card").nth(4).getByRole("button", { name: locale.up }).click();
    const built = await cardTitles(page);
    expect(built).not.toEqual(opening);
    expect(built[3]).toBe(opening[4]);

    await reloadPersisted(page);
    await expectBoardDirectReady(page);
    await expect.poll(() => cardTitles(page)).toEqual(built);
    expect(await gamePlayed(page, "timeline")).toBeUndefined();

    await page.getByTestId("game-board").getByRole("button", { name: locale.submit }).click();
    const result = page.getByTestId("game-result");
    await expect(result).toBeVisible();
    const moved = result.locator(".timeline-results-item", { hasText: built[3]! });
    await expect(moved.getByTestId("timeline-result-positions")).toContainText(locale.position);
    await expect(result.getByTestId("timeline-result-positions")).toHaveCount(5);
  });
}
