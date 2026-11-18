import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import type { QuizSession } from "../src/lib/quiz-types";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { expect, test } from "./fixtures/feedback-build";
import { LOCAL_BUILD_TAG } from "./target";

const dataDir = fileURLToPath(new URL("../src/tests/fixtures/", import.meta.url));

async function sessionFixture(page: Page) {
  const manifest = JSON.parse(readFileSync(join(dataDir, "manifest-v2.json"), "utf8"));
  const key = "pt-BR.standard";
  const entry = manifest.sessions[key];
  const session = JSON.parse(readFileSync(join(dataDir, entry.path), "utf8")) as QuizSession;
  const body = JSON.stringify(session);
  const hash = createHash("sha256").update(body).digest("hex");
  const path = `session.${key}.${hash}.json`;
  manifest.sessions[key] = { ...entry, path, sha256: hash };
  await page.route("**/data/manifest-v3.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/catalog-manifest-v1.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/data/manifest-v2.json", (route) => route.fulfill({ json: manifest }));
  await page.route(`**/data/${path}`, (route) => route.fulfill({ body, contentType: "application/json" }));
  return session.questions.length;
}

async function settleEffects(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => setTimeout(resolve, 100));
  }));
}

for (const scenario of ["normal", "moved while pending", "external before programmatic click"] as const) {
  test(`feedback focus: ${scenario}`, { tag: LOCAL_BUILD_TAG }, async ({ page, feedbackURL }) => {
    const count = await sessionFixture(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    await page.route("https://tbbc.app/api/rating", async (route: Route) => {
      requested();
      await held;
      await route.fulfill({ status: 201, json: { ok: true, id: "vote-id" } });
    });
    await page.goto(`${feedbackURL}/pt-br/?theme=history&mode=standard`);
    await page.getByTestId("game-start").click();
    for (let index = 0; index < count; index += 1) {
      const board = page.getByTestId("game-board");
      await board.locator("label.option").first().click();
      await board.getByRole("button", { name: "Responder", exact: true }).click();
      await page.waitForTimeout(NEXT_GUARD_MS + 50);
      await board.getByRole("button", { name: /Próxima pergunta|Ver resultado/ }).click();
    }
    await expect(page.getByTestId("game-result")).toBeVisible();
    const vote = page.getByRole("button", { name: "Gostei", exact: true });
    await expect(vote).toBeVisible();
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "elsewhere";
      button.textContent = "Elsewhere";
      document.body.append(button);
    });
    const elsewhere = page.locator("#elsewhere");
    if (scenario === "external before programmatic click") {
      await elsewhere.focus();
      await vote.evaluate(button => (button as HTMLButtonElement).click());
    } else {
      await vote.click();
    }
    await started;
    if (scenario === "moved while pending") await elsewhere.focus();
    release();
    const comment = page.getByLabel("Comentário opcional");
    await expect(comment).toBeVisible();
    await settleEffects(page);
    if (scenario === "normal") await expect(comment).toBeFocused();
    else await expect(elsewhere).toBeFocused();
  });
}
