import { test, expect } from "./fixtures/consent";
import { QuizPage } from "./pages/quiz.page";

test.describe("quiz playthrough", () => {
  // Full round (~10 questions) plus setup; leave headroom over boot timeouts.
  test.describe.configure({ timeout: 120_000 });

  test("pt-BR quiz reaches game-result with any answers", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();
    await quiz.answerAllAny();
    await quiz.expectResult();
  });
});
