import type { Page } from "@playwright/test";
import { NEXT_GUARD_MS } from "../src/components/Quiz/answer-feedback-constants";
import { NEXT_GUARD_MS as MAP_NEXT_GUARD_MS } from "../src/components/MapPilot/useMapRoundActions";
import { test, expect } from "./fixtures/consent";
import { installGuardClock } from "./helpers/guard-clock";
import { MapPage } from "./pages/map.page";
import { QuizPage } from "./pages/quiz.page";

/**
 * The Next button ignores a click for NEXT_GUARD_MS after it replaces Submit.
 * The other specs cross that guard by moving the page clock, so this one shows
 * the guard itself on that clock: paused, so the elapsed time is exact. Each
 * game stamps the guard on its own (the quiz in a layout effect, the map in the
 * Submit handler), and `performance.now()` does not move between the stamp and
 * the click, so a click at 299 ms is refused and one at 300 ms goes through.
 */

/** Freezes the page clock a second ahead: nothing moves until the test moves it. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1_000));
}

/** Runs the microtasks a click queued (Preact renders in one), which a paused clock cannot. */
async function settleRender(page: Page): Promise<void> {
  await page.evaluate(() => Promise.resolve());
}

test.describe("the Next guard on a controlled clock", () => {
  // The ticket fixes the guard at 300 ms; checking the constant keeps a change
  // to it from moving the threshold this test proves together with it.
  test("both guards stay at 300 ms", () => {
    expect(NEXT_GUARD_MS).toBe(300);
    expect(MAP_NEXT_GUARD_MS).toBe(300);
  });

  test("quiz: Next refuses a click at 299 ms and takes one at 300 ms", async ({ page, baseURL }) => {
    await installGuardClock(page);
    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();
    const board = page.getByTestId("game-board");
    const heading = board.getByRole("heading", { level: 2 });
    const first = await heading.textContent();

    await board.locator("label.option").first().click();
    await expect(board.getByRole("radio").first()).toBeChecked();
    const submit = board.getByRole("button", { name: "Responder" });
    await expect(submit).toBeEnabled();
    await pauseClock(page);
    await submit.click();
    const next = board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ });
    await expect(next).toBeVisible();

    await next.click();
    await settleRender(page);
    await expect(heading, "a click right after the verdict does not advance").toHaveText(first!);
    await page.clock.runFor(NEXT_GUARD_MS - 1);
    await next.click();
    await settleRender(page);
    await expect(heading, `a click ${NEXT_GUARD_MS - 1} ms after the verdict does not advance`).toHaveText(first!);
    await page.clock.runFor(1);
    await next.click();
    await expect(heading, `a click ${NEXT_GUARD_MS} ms after the verdict advances`).not.toHaveText(first!);
  });

  test("map: Next refuses a click at 299 ms and takes one at 300 ms", async ({ page, baseURL }) => {
    await installGuardClock(page);
    await new MapPage(page, baseURL!).open();
    const board = page.getByTestId("game-board");
    const progress = page.locator(".map-pilot-progress");
    await expect(progress).toHaveText("Pergunta 1 de 10");

    const country = board.locator("[data-testid^='answer-country-']").first();
    await expect(country).toBeEnabled();
    await country.click();
    const submit = board.getByRole("button", { name: /^Responder$/ });
    await expect(submit).toBeVisible();
    await pauseClock(page);
    await submit.click();
    const next = board.getByRole("button", { name: /Próxima data|Ver resultado/ });
    await expect(next).toBeVisible();

    await next.click();
    await settleRender(page);
    await expect(progress, "a click right after the verdict does not advance").toHaveText("Pergunta 1 de 10");
    await page.clock.runFor(MAP_NEXT_GUARD_MS - 1);
    await next.click();
    await settleRender(page);
    await expect(progress, `a click ${MAP_NEXT_GUARD_MS - 1} ms after the verdict does not advance`).toHaveText("Pergunta 1 de 10");
    await page.clock.runFor(1);
    await next.click();
    await expect(progress, `a click ${MAP_NEXT_GUARD_MS} ms after the verdict advances`).toHaveText("Pergunta 2 de 10");
  });
});
