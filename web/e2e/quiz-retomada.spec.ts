import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/consent";
import {
  QUIZ_PROGRESS_LEGACY_STORAGE_KEY,
  quizProgressStorageKey,
  type QuizProgressConfigIdentity,
} from "../src/components/Quiz/storage";
import { joinBaseUrl } from "../src/lib/join-base-url";
import type { Locale } from "../src/lib/quiz-types";

/**
 * Q04 local resume: reload keeps identity, selection, clues, deadline and
 * results without duplicating stats. Invalid saves warn and leave the page
 * usable. Saves are per config (locale|mode|theme|decades); visiting another
 * config must not destroy an in-progress round. Catalog remains unpublished
 * (QUIZ_CATALOG off).
 */

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

const locales = [
  {
    id: "pt",
    locale: "pt-BR" as Locale,
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
    locale: "en" as Locale,
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

function defaultConfig(locale: Locale): QuizProgressConfigIdentity {
  return { locale, playMode: "standard", theme: "history", decades: [] };
}

function progressKey(locale: Locale): string {
  return quizProgressStorageKey(defaultConfig(locale));
}

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

async function waitForProgressSave(page: Page, locale: Locale) {
  const key = progressKey(locale);
  await expect.poll(async () => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key)).not.toBeNull();
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
      await waitForProgressSave(page, locale.locale);

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
  await waitForProgressSave(page, "pt-BR");

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
  await waitForProgressSave(page, "pt-BR");
  const clueText = "Pista salva para retomada no e2e.";
  const key = progressKey("pt-BR");
  await page.evaluate(({ storageKey, text }) => {
    const raw = window.localStorage.getItem(storageKey);
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
    window.localStorage.setItem(storageKey, JSON.stringify(save));
  }, { storageKey: key, text: clueText });

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
  const next = page.getByRole("button", { name: locales[1].next });
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled({ timeout: 5_000 });
  await page.getByRole("button", { name: locales[1].giveUp }).click();
  await page.getByRole("button", { name: locales[1].confirmGiveUp }).click();
  await expect(page.getByTestId("game-result")).toBeVisible();
  await expect(page.getByRole("heading", { name: locales[1].result })).toBeVisible();
  await waitForProgressSave(page, "en");

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
  await waitForProgressSave(page, "pt-BR");

  // Pin an already-elapsed deadline so reload applies timeout once.
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("missing progress save");
    const save = JSON.parse(raw) as Record<string, unknown>;
    save.question_deadline_ms = Date.now() - 1_000;
    save.machine_state = "question.ready";
    save.history = [];
    save.question_index = 0;
    save.selected_id = null;
    save.timed_out = false;
    window.localStorage.setItem(storageKey, JSON.stringify(save));
  }, progressKey("pt-BR"));

  await page.reload();
  await expect(page.getByText(locales[0].timedOut)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByTestId("game-result")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("rejects an invalid save schema with a clear warning (pt + en)", async ({ page, baseURL }) => {
  for (const locale of locales) {
    await page.addInitScript(({ storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify({ schema_version: "kpop-quiz-progress-v0", session_id: "x" }));
    }, { storageKey: progressKey(locale.locale) });
    await page.goto(joinBaseUrl(baseURL!, locale.path));
    await expect(page.getByText(locale.invalid)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("game-start")).toBeEnabled();
    await page.getByTestId("game-start").click();
    await expect(page.getByTestId("game-board")).toBeVisible();
  }
});

test("rejects a same-config identity drift with a clear warning (pt, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[0]);
  await waitForProgressSave(page, "pt-BR");
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("missing progress save");
    const save = JSON.parse(raw) as { session_id: string; session: { session_id: string } };
    save.session_id = "d".repeat(64);
    save.session.session_id = "d".repeat(64);
    window.localStorage.setItem(storageKey, JSON.stringify(save));
  }, progressKey("pt-BR"));

  await page.reload();
  await expect(page.getByText(locales[0].incompatible)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-start")).toBeEnabled();
});

test("open give-up confirmation is not authorized after reload (pt, phone-390)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[2]);
  await page.getByRole("button", { name: locales[0].giveUp }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await waitForProgressSave(page, "pt-BR");

  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("game-result")).toHaveCount(0);
});

test("switching locale keeps the other config's in-progress save (pt→en, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[0]);
  const prompt = await firstPrompt(page);
  const option = page.getByTestId("game-board").locator("label.option").first();
  const optionText = (await option.textContent())!.trim();
  await option.click();
  await waitForProgressSave(page, "pt-BR");
  const ptRaw = await page.evaluate((key) => window.localStorage.getItem(key), progressKey("pt-BR"));
  expect(ptRaw).toBeTruthy();

  await page.goto(joinBaseUrl(baseURL!, "/en/"));
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  const stillPt = await page.evaluate((key) => window.localStorage.getItem(key), progressKey("pt-BR"));
  expect(stillPt).toBe(ptRaw);

  await page.goto(joinBaseUrl(baseURL!, "/pt-br/"));
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByTestId("game-board").locator("label.option").filter({ hasText: optionText })).toBeChecked();
});

test("migrates a compatible legacy single-slot save (pt, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[0]);
  const prompt = await firstPrompt(page);
  await page.getByTestId("game-board").locator("label.option").first().click();
  await waitForProgressSave(page, "pt-BR");

  // Move the per-config payload back onto the legacy key to simulate an old client.
  await page.evaluate(({ slotKey, legacyKey }) => {
    const raw = window.localStorage.getItem(slotKey);
    if (!raw) throw new Error("missing slot save");
    window.localStorage.setItem(legacyKey, raw);
    window.localStorage.removeItem(slotKey);
  }, { slotKey: progressKey("pt-BR"), legacyKey: QUIZ_PROGRESS_LEGACY_STORAGE_KEY });

  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  const migrated = await page.evaluate(({ slotKey, legacyKey }) => ({
    slot: window.localStorage.getItem(slotKey),
    legacy: window.localStorage.getItem(legacyKey),
  }), { slotKey: progressKey("pt-BR"), legacyKey: QUIZ_PROGRESS_LEGACY_STORAGE_KEY });
  expect(migrated.slot).toBeTruthy();
  expect(migrated.legacy).toBeNull();
});

test("incompatible legacy save warns and does not erase another config slot (en, desktop)", async ({ page, baseURL }) => {
  // Build a real pt-BR save, copy it onto the legacy single-slot key, then open EN.
  await startRound(page, baseURL!, locales[0], viewports[0]);
  await waitForProgressSave(page, "pt-BR");
  const ptRaw = await page.evaluate(({ slotKey, legacyKey }) => {
    const raw = window.localStorage.getItem(slotKey);
    if (!raw) throw new Error("missing");
    window.localStorage.setItem(legacyKey, raw);
    return raw;
  }, { slotKey: progressKey("pt-BR"), legacyKey: QUIZ_PROGRESS_LEGACY_STORAGE_KEY });

  await page.goto(joinBaseUrl(baseURL!, "/en/"));
  await expect(page.getByText(locales[1].incompatible)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-start")).toBeEnabled();
  const preserved = await page.evaluate(({ slotKey, legacyKey }) => ({
    slot: window.localStorage.getItem(slotKey),
    legacy: window.localStorage.getItem(legacyKey),
  }), { slotKey: progressKey("pt-BR"), legacyKey: QUIZ_PROGRESS_LEGACY_STORAGE_KEY });
  expect(preserved.slot).toBe(ptRaw);
  expect(preserved.legacy).toBe(ptRaw);
});

test("keyboard selection autosaves and restores after reload (pt, desktop)", async ({ page, baseURL }) => {
  await startRound(page, baseURL!, locales[0], viewports[0]);
  const prompt = await firstPrompt(page);
  const radio = page.getByTestId("game-board").getByRole("radio").first();
  const optionText = (await page.getByTestId("game-board").locator("label.option").first().textContent())!.trim();
  await radio.focus();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
  await waitForProgressSave(page, "pt-BR");

  await page.reload();
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("game-board").getByRole("heading", { level: 2 })).toHaveText(prompt);
  await expect(page.getByTestId("game-board").locator("label.option").filter({ hasText: optionText })).toBeChecked();
});
