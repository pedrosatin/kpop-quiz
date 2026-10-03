import { test, expect } from "./fixtures/consent";
import { expectQuizBoardVisible, expectQuizSetupReady } from "./helpers/boot";

const quizHomePath = "/pt-br/";

test.describe("quiz smoke", () => {
  test(`${quizHomePath} boots setup and starts a round`, async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const response = await page.goto(quizHomePath);
    expect(response, "navigation must return a response").not.toBeNull();
    expect(response!.ok(), `expected OK for ${quizHomePath}, got ${response!.status()}`).toBeTruthy();

    await expectQuizSetupReady(page);

    await page.getByTestId("game-start").click();
    await expectQuizBoardVisible(page);
  });
});
