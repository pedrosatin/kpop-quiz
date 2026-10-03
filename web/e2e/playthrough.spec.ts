import { test, expect } from "./fixtures/consent";
import { QuizPage } from "./pages/quiz.page";
import { ConnectionsPage } from "./pages/connections.page";
import { NameGuessPage } from "./pages/name-guess.page";
import { TimelinePage } from "./pages/timeline.page";
import { MapPage } from "./pages/map.page";
import { GridPage } from "./pages/grid.page";
import { WordSearchPage } from "./pages/word-search.page";

test.describe("pt-BR playthroughs", () => {
  // Full rounds plus setup; leave headroom over boot timeouts.
  test.describe.configure({ timeout: 120_000 });

  test("quiz reaches game-result with any answers", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const quiz = new QuizPage(page, baseURL!);
    await quiz.open();
    await quiz.start();
    await quiz.answerAllAny();
    await quiz.expectResult();
  });

  test("connections reaches game-result after 4 wrong groups", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const connections = new ConnectionsPage(page, baseURL!);
    await connections.open();
    await connections.loseWithWrongGuesses();
    await connections.expectResult();
  });

  test("name-guess reaches game-result after wrong valid guesses", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const nameGuess = new NameGuessPage(page, baseURL!);
    await nameGuess.open();
    await nameGuess.loseWithWrongGuesses();
    await nameGuess.expectResult();
  });

  test("timeline reaches game-result on default-order submit", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const timeline = new TimelinePage(page, baseURL!);
    await timeline.open();
    await timeline.submitDefaultOrder();
    await timeline.expectResult();
  });

  test("map reaches game-result with any country × 10", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const map = new MapPage(page, baseURL!);
    await map.open();
    await map.answerAllAny();
    await map.expectResult();
  });

  test("grid reaches game-result or asserts missing+retry", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const grid = new GridPage(page, baseURL!);
    await grid.open();
    const outcome = await grid.playOrAssertMissing();
    if (outcome === "result") {
      await grid.expectResult();
    }
  });

  test("word-search reaches game-result via daily coords", async ({ page, baseURL }) => {
    expect(baseURL, "BASE_URL / playwright baseURL must be set").toBeTruthy();

    const wordSearch = new WordSearchPage(page, baseURL!);
    await wordSearch.open();
    await wordSearch.completeFromDailyCoords();
    await wordSearch.expectResult();
  });
});
