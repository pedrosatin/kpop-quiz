import { test, expect } from "./fixtures/consent";
import { QuizPage } from "./pages/quiz.page";
import { ConnectionsPage } from "./pages/connections.page";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { SUBMIT_GUARD_MS } from "../src/components/Connections/ConnectionsGameContent";
import { crossGuard, installGuardClock } from "./helpers/guard-clock";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { visibleLabels } from "./helpers/visible-names";
import { skipUnlessPublished } from "./helpers/published";

interface ConnectionsDaily {
  reference_date: string;
  items: Array<{
    id: string;
    canonical_name: string;
    labels: Record<string, string>;
  }>;
  categories: Array<{ id: string; item_ids: string[] }>;
}

async function animationSnapshot(locator: import("@playwright/test").Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const raw = style.animationDuration;
    const first = raw.split(",")[0]?.trim() ?? raw;
    let durationMs = Number.NaN;
    if (first.endsWith("ms")) durationMs = Number.parseFloat(first);
    else if (first.endsWith("s")) durationMs = Number.parseFloat(first) * 1000;
    return {
      animationName: style.animationName,
      durationMs,
    };
  });
}

/**
 * Boundary checks for feel feedback: observable state on the Quiz pilot,
 * motion opt-in via data-feedback, and collapsed duration under
 * prefers-reduced-motion. No golden frames.
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

  test("Quiz title animates; buttons do not; reduced motion collapses duration", async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();
    await installGuardClock(page);

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
    const expectedName = kind === "correct" ? "feedback-correct" : "feedback-incorrect";

    const title = bar.locator(".game-actions-title");
    await expect(title).toBeVisible();
    const withMotion = await animationSnapshot(title);
    expect(withMotion.animationName).toBe(expectedName);
    expect(withMotion.durationMs).toBe(180);

    const buttonAnim = await bar.locator(".btn").first().evaluate((el) => getComputedStyle(el).animationName);
    expect(buttonAnim).toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await animationSnapshot(title);
    expect(reduced.durationMs).toBeLessThan(20);

    await crossGuard(page, NEXT_GUARD_MS + 50);
    await board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ }).click();
    await expect(page.getByTestId("game-board").or(page.getByTestId("game-result"))).toBeVisible();
  });

  test("Connections wrong guess title does not animate", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    await skipUnlessPublished(page, baseURL!, "connections.daily.json");
    await installGuardClock(page);

    const connections = new ConnectionsPage(page, baseURL!);
    await connections.open();

    const puzzle = await loadPreferNextDaily<ConnectionsDaily>(
      page.request,
      baseURL!,
      "connections.daily.json",
    );
    const visible = visibleLabels(puzzle.items, "pt-BR");
    const board = page.getByTestId("game-board");
    const submit = board.getByRole("button", { name: "Enviar" });

    const ids = puzzle.categories.map((cat) => cat.item_ids[0]!);
    for (const id of ids) {
      const label = visible.get(id);
      expect(label, `connections item ${id}`).toBeTruthy();
      await board.getByRole("button", { name: label!, exact: true }).click();
    }

    await expect(submit).toBeEnabled();
    await crossGuard(page, SUBMIT_GUARD_MS + 50);
    await submit.click();

    const bar = board.locator(".game-actions.is-incorrect");
    await expect(bar).toBeVisible();
    expect(await bar.getAttribute("data-feedback")).toBeNull();

    const title = bar.locator(".game-actions-title").first();
    await expect(title).toBeVisible();
    const snap = await animationSnapshot(title);
    expect(snap.animationName).toBe("none");
  });
});
