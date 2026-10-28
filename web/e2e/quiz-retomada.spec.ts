import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/consent";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { QUIZ_PROGRESS_STORAGE_KEY } from "../src/components/Quiz/storage";
import { joinBaseUrl } from "../src/lib/join-base-url";

/**
 * Q04 local resume: reload keeps identity, selection, clues, deadline and
 * results without duplicating stats. Invalid saves warn and leave the page
 * usable. Catalog remains unpublished (QUIZ_CATALOG off).
 */

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

const locales = [
  {
    id: "pt",
    path: "/pt-br/",
    start: "Começar partida",
    submit: "Responder",
    next: /Próxima pergunta|Ver resultado/,
    giveUp: "Desistir",
    confirmGiveUp: "Sim, desistir",
    result: "Fim da partida",
    timedOut: "Acabou o tempo.",
    correct: "Você acertou.",
    enableTimer: "Limitar cada pergunta a 20 segundos",
    invalid: /progresso salvo está inválido/,
    incompatible: /não combina com os dados atuais/,
  },
  {
    id: "en",
    path: "/en/",
    start: "Start game",
    submit: "Submit answer",
    next: /Next question|See results/,
    giveUp: "Give up",
    confirmGiveUp: "Yes, give up",
    result: "Game over",
    timedOut: "Time's up.",
    correct: "Correct.",
    enableTimer: "Limit each question to 20 seconds",
    invalid: /saved progress is invalid/,
    incompatible: /does not match the current data/,
  },
] as const;

async function startRound(page: Page, baseURL: string, locale: (typeof locales)[number], viewport: (typeof viewports)[number]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(joinBaseUrl(baseURL, locale.path));
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-board")).toBeVisible();
}

async function firstPrompt(page: Page): Promise<string> {
  return (await page.getByTestId("game-board").getByRole("heading", { level: 2 }).textContent())!;
}

async function waitForProgressSave(page: Page) {
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), QUIZ_PROGRESS_STORAGE_KEY)).not.toBeNull();
}

for (const locale of locales) {
  for (const viewport of viewports) {
    test(`resumes unanswered selection after reload (${locale.id}, ${viewport.name})`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await startRound(page, baseURL!, locale, viewport);
      const prompt = await firstPrompt(page);
      const option = page.getByTestId("game-board").locator("label.option").first();
      const optionText = (await option.textContent())!.trim();
      await option.click();
      await waitForProgressSave(page);

      await page.reload();
      await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
      await expect(page.getByTestId("game-setup")).toHaveCount(0);
      await expect(page.getByTestId("game-board").locator("label.option").filter({ hasText: optionText })).toBeChecked();
    });
  }
}

test("resumes answered feedback after reload (pt, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[0]);
  const prompt = await firstPrompt(page);
  await page.getByTestId("game-board").locator("label.option").first().click();
  await page.getByRole("button", { name: locales[0].submit }).click();
  await expect(page.getByTestId("game-board").getByRole("status").first()).toBeVisible();
  await waitForProgressSave(page);

  await page.reload();
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByRole("button", { name: locales[0].next })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("resumes a used clue after reload (pt, desktop)", async ({ page, baseURL }) => {
  // Published sessions may ship without clues; embed a safe clue in the local
  // save (same question ids as the live artifact) and restore from that payload.
  await startRound(page, baseURL!, locales[0], viewports[0]);
  const prompt = await firstPrompt(page);
  await waitForProgressSave(page);
  const clueText = "Pista salva para retomada no e2e.";
  await page.evaluate(({ key, text }) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("missing progress save");
    const save = JSON.parse(raw) as {
      session: {
        questions: Array<{
          fact_base_ids: string[];
          clues_available: Array<Record<string, unknown>>;
          evidence: Array<Record<string, unknown>>;
        }>;
      };
      revealed_clues: string[];
    };
    const question = save.session.questions[0]!;
    const evidence = question.evidence[0]!;
    const clueId = "c".repeat(64);
    question.clues_available = [{
      id: clueId,
      type: "decade",
      text,
      fact_base_ids: [question.fact_base_ids[0]],
      evidence: [{
        fact_base_id: question.fact_base_ids[0],
        source_key: evidence.source_key,
        source_url: evidence.source_url,
        revision_id: evidence.revision_id,
        locator: evidence.locator,
      }],
    }];
    save.revealed_clues = [clueId];
    window.localStorage.setItem(key, JSON.stringify(save));
  }, { key: QUIZ_PROGRESS_STORAGE_KEY, text: clueText });

  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByText(clueText)).toBeVisible();
});

test("restores results without duplicating the recorded match (en, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[1], viewports[0]);
  // Answer first, then give up to finish quickly with a stable result.
  await page.getByTestId("game-board").locator("label.option").first().click();
  await page.getByRole("button", { name: locales[1].submit }).click();
  await expect(page.getByRole("button", { name: locales[1].next })).toBeVisible();
  await page.waitForTimeout(NEXT_GUARD_MS + 50);
  await page.getByRole("button", { name: locales[1].giveUp }).click();
  await page.getByRole("button", { name: locales[1].confirmGiveUp }).click();
  await expect(page.getByTestId("game-result")).toBeVisible();
  await expect(page.getByRole("heading", { name: locales[1].result })).toBeVisible();
  await waitForProgressSave(page);

  const statsBefore = await page.evaluate(() => window.localStorage.getItem("kpop-player-stats-v1"));
  await page.reload();
  await expect(page.getByTestId("game-result")).toBeVisible({ timeout: 30_000 });
  const statsAfter = await page.evaluate(() => window.localStorage.getItem("kpop-player-stats-v1"));
  expect(statsAfter).toBe(statsBefore);
});

test("restores the original deadline and expires once without skipping ahead (pt, desktop)", async ({ page, baseURL }) => {
  await page.goto(joinBaseUrl(baseURL!, "/pt-br/"));
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("checkbox", { name: locales[0].enableTimer }).check();
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-board")).toBeVisible();
  const prompt = await firstPrompt(page);
  await waitForProgressSave(page);

  // Pin an already-elapsed deadline so reload applies timeout once.
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("missing progress save");
    const save = JSON.parse(raw) as Record<string, unknown>;
    save.question_deadline_ms = Date.now() - 1_000;
    save.machine_state = "question.ready";
    save.history = [];
    save.question_index = 0;
    save.selected_id = null;
    save.timed_out = false;
    window.localStorage.setItem(key, JSON.stringify(save));
  }, QUIZ_PROGRESS_STORAGE_KEY);

  await page.reload();
  await expect(page.getByText(locales[0].timedOut)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByTestId("game-result")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("rejects an incompatible save schema with a clear warning (pt + en)", async ({ page, baseURL }) => {
  for (const locale of locales) {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ schema_version: "kpop-quiz-progress-v0", session_id: "x" }));
    }, QUIZ_PROGRESS_STORAGE_KEY);
    await page.goto(joinBaseUrl(baseURL!, locale.path));
    await expect(page.getByText(locale.invalid)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("game-start")).toBeEnabled();
    await page.getByTestId("game-start").click();
    await expect(page.getByTestId("game-board")).toBeVisible();
  }
});

test("open give-up confirmation is not authorized after reload (pt, phone-390)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[2]);
  await page.getByRole("button", { name: locales[0].giveUp }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await waitForProgressSave(page);

  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("game-result")).toHaveCount(0);
});
