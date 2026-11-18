import { test, expect } from "./fixtures/consent";
import { QuizPage } from "./pages/quiz.page";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";

/**
 * Boundary checks for feel feedback: observable state on the Quiz pilot and
 * collapsed animation under prefers-reduced-motion. No golden frames.
 */
test.describe("feel feedback (Quiz pilot)", () => {
  test.describe.configure({ timeout: 60_000 });

  test("answer bar exposes data-feedback after submit", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();

    const board = page.getByTestId("game-board");
    await board.locator("label.option").first().click();
    await board.getByRole("button", { name: "Responder" }).click();

    const bar = board.locator(".game-actions[data-feedback]");
    await expect(bar).toBeVisible();
    const kind = await bar.getAttribute("data-feedback");
    expect(kind === "correct" || kind === "incorrect").toBe(true);
    await expect(bar.locator(".feedback-mark")).toBeVisible();
    await expect(bar.locator(".game-actions-title")).toBeVisible();
  });

  test("reduced motion collapses feedback animation duration", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    await page.emulateMedia({ reducedMotion: "reduce" });

    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();

    const board = page.getByTestId("game-board");
    await board.locator("label.option").first().click();
    await board.getByRole("button", { name: "Responder" }).click();

    const title = board.locator(".game-actions[data-feedback] .game-actions-title");
    await expect(title).toBeVisible();

    const durationMs = await title.evaluate((el) => {
      const raw = getComputedStyle(el).animationDuration;
      // May be a list; take the first value.
      const first = raw.split(",")[0]?.trim() ?? raw;
      if (first.endsWith("ms")) return Number.parseFloat(first);
      if (first.endsWith("s")) return Number.parseFloat(first) * 1000;
      return Number.NaN;
    });
    // base.css forces 0.01ms under prefers-reduced-motion.
    expect(durationMs).toBeLessThan(20);

    // Finish one advance so the guard path still works with reduced motion.
    await page.waitForTimeout(NEXT_GUARD_MS + 50);
    await board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ }).click();
    await expect(page.getByTestId("game-board").or(page.getByTestId("game-result"))).toBeVisible();
  });

  test("result title carries data-feedback=result", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();
    await quiz.answerAllAny();
    await quiz.expectResult();
    await expect(page.locator('#result-heading[data-feedback="result"]')).toBeVisible();
  });
});
