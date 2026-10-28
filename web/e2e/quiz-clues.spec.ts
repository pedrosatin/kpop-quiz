import { cpSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test as base, expect, type Page } from "@playwright/test";
import { preview } from "astro";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { joinBaseUrl } from "../src/lib/join-base-url";
import type { PlayMode, QuizQuestion, QuizSession } from "../src/lib/quiz-types";

// The real consent island only renders when a GA4 id is built in, which the
// default dist leaves out. Build one that has it. QUIZ_CLUES_DATA_DIR swaps in
// a dataset generated elsewhere (for instance straight from the database), so
// the same checks can follow whatever the pipeline produced.
const test = base.extend<{}, { consentURL: string }>({
  consentURL: [async ({}, use) => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const scratch = join(root, "../.scratch");
    await mkdir(scratch, { recursive: true });
    // Astro moves assets by rename, so output must share the source filesystem.
    const outDir = await mkdtemp(join(scratch, "quiz-clues-"));
    let server: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await promisify(execFile)(process.execPath, ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
        cwd: root,
        env: { ...process.env, NODE_ENV: "production", ASTRO_BASE: "", BASE_URL: "/", PUBLIC_GA4_ID: "G-E2EQUIZCLUES", PUBLIC_CF_BEACON_TOKEN: "" },
        timeout: 120_000,
      });
      if (process.env.QUIZ_CLUES_DATA_DIR) {
        rmSync(join(outDir, "data"), { recursive: true, force: true });
        cpSync(process.env.QUIZ_CLUES_DATA_DIR, join(outDir, "data"), { recursive: true });
      }
      server = await preview({ root, outDir, base: "/", server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
      await use(`http://127.0.0.1:${server.port}`);
    } finally {
      await server?.stop();
      await rm(outDir, { recursive: true, force: true });
    }
  }, { scope: "worker", timeout: 120_000 }],
});

test.use({ serviceWorkers: "block" });

/**
 * The browser must show what the published session says: the clue when the
 * artifact carries one, a plain notice when it does not, and a cost only for a
 * clue the player opens. Each case reads the session the page fetched, so the
 * check follows whatever the pipeline published.
 */

const locales = [
  { id: "pt", path: "/pt-br/", reject: /^Recusar Google Analytics$/, start: "Começar partida", submit: "Responder", next: /Próxima pergunta|Ver resultado/, source: "Ver fonte",
    clueButton: (cost: number) => `Ver pista (-${cost} pontos)`, opened: "Pista aberta",
    none: { assisted: "Esta pergunta não tem pista disponível.", standard: "Esta pergunta não tem pista disponível. Nenhum ponto será descontado." } },
  { id: "en", path: "/en/", reject: /^Reject Google Analytics$/, start: "Start game", submit: "Submit answer", next: /Next question|See results/, source: "Show source",
    clueButton: (cost: number) => `Show clue (-${cost} points)`, opened: "Clue shown",
    none: { assisted: "This question has no clue available.", standard: "This question has no clue available. No points will be deducted." } },
] as const;

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

// The daily game switches to the next day's set once that day arrives, so
// "daily-tomorrow" runs the page with the clock a day and a half ahead.
const scenarios = [
  { name: "daily", query: "theme=daily", tomorrow: false },
  { name: "daily-tomorrow", query: "theme=daily", tomorrow: true },
  { name: "decade-2000", query: "decade=2000", tomorrow: false },
] as const;

/** The banner is either still open or already refused; the clue states must hold in both. */
const consents = ["rejected", "open"] as const;
type Consent = (typeof consents)[number];

const shotDir = process.env.QUIZ_CLUES_SHOTS;

async function seedConsent(page: Page) {
  await page.addInitScript((key) => window.localStorage.setItem(key, "rejected"), CONSENT_STORAGE_KEY);
}

/**
 * Opens the quiz and returns the session artifacts the page fetched. The
 * daily game reads the current day and may then read the next one, so the
 * caller picks the one the board shows.
 */
async function openSession(page: Page, baseURL: string, path: string, mode: PlayMode, query: string, consent?: { state: Consent; reject: RegExp }) {
  if (!consent) await seedConsent(page);
  const bodies: QuizSession[] = [];
  page.on("response", async (response) => {
    if (/\/data\/(?:next\/)?session\.[^/]+\.json$/.test(response.url()) && response.ok()) {
      bodies.push((await response.json()) as QuizSession);
    }
  });
  await page.goto(`${joinBaseUrl(baseURL, path)}?mode=${mode}&${query}`);
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  expect(bodies.length, "the page must fetch a session artifact").toBeGreaterThan(0);
  if (consent) {
    const banner = page.locator(".consent-banner");
    await expect(banner, "the consent build must render the real banner").toBeVisible();
    if (consent.state === "rejected") {
      await banner.getByRole("button", { name: consent.reject }).click();
      await expect(banner).toHaveCount(0);
    }
  }
  return bodies;
}

/** Starts the game and returns the fetched session whose first question is on screen. */
async function startAndMatch(page: Page, fetched: QuizSession[]): Promise<QuizSession> {
  await page.getByTestId("game-start").click();
  const heading = page.getByTestId("game-board").getByRole("heading", { level: 2 });
  await expect(heading).toBeVisible();
  const shown = (await heading.textContent())!;
  const matches = fetched.filter((candidate) => candidate.questions[0]!.prompt === shown);
  expect(matches, `no fetched session starts with "${shown}"`).not.toHaveLength(0);
  return matches.at(-1)!;
}

async function expectInsideViewport(page: Page, testId: string) {
  const target = page.getByTestId(testId);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // Nothing (such as the fixed action bar) may sit on top of it.
  const covered = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !(top && (top === element || element.contains(top)));
  });
  expect(covered, `${testId} is covered by another element`).toBe(false);
}

async function answerCorrectly(page: Page, question: QuizQuestion, locale: (typeof locales)[number]) {
  const board = page.getByTestId("game-board");
  const index = question.options.findIndex((option) => option.id === question.answer_option_id);
  await board.locator("label.option").nth(index).click();
  await board.getByRole("button", { name: locale.submit }).click();
  const advance = board.getByRole("button", { name: locale.next });
  await expect(advance).toBeVisible();
  return advance;
}

for (const locale of locales)
  for (const viewport of viewports)
    for (const mode of ["assisted", "standard", "expert"] as const)
      for (const scenario of scenarios)
        for (const consent of consents) {
        // The refused banner is checked on the daily game; the other scenarios reuse the same board.
        if (consent === "rejected" && scenario.name !== "daily") continue;
        test(`quiz ${locale.id} ${viewport.name} ${mode} ${scenario.name} banner ${consent}: clues and notices match the published session`, async ({ page, context, consentURL }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await context.route("**/*", (route) => new URL(route.request().url()).origin === consentURL ? route.continue() : route.abort());
          if (scenario.tomorrow) await page.clock.setFixedTime(Date.now() + 36 * 3_600_000);
          const fetched = await openSession(page, consentURL, locale.path, mode, scenario.query, { state: consent, reject: locale.reject });
          const session = await startAndMatch(page, fetched);
          expect(session.config.play_mode).toBe(mode);
          const board = page.getByTestId("game-board");

          let expectedScore = 0;
          let withClue = 0;
          let withoutClue = 0;
          let related = 0;
          for (const [index, question] of session.questions.entries()) {
            await expect(board.getByRole("heading", { level: 2 })).toHaveText(question.prompt);
            const notice = page.getByTestId("quiz-no-clue");
            const clueButton = board.getByRole("button", { name: /Ver pista|Show clue|Pista aberta|Clue shown/ });
            let cost = 0;
            if (mode === "expert") {
              // Expert has no clues by design and says nothing about them.
              expect(question.clues_available).toEqual([]);
              withoutClue += 1;
              await expect(notice).toHaveCount(0);
              await expect(clueButton).toHaveCount(0);
            } else if (question.clues_available.length === 0) {
              withoutClue += 1;
              await expect(notice).toHaveText(locale.none[mode]);
              await expect(clueButton).toHaveCount(0);
              await expectInsideViewport(page, "quiz-no-clue");
              if (shotDir && withoutClue === 1) {
                mkdirSync(shotDir, { recursive: true });
                await page.screenshot({ path: join(shotDir, `${locale.id}-${viewport.name}-${mode}-${scenario.name}-no-clue.png`) });
              }
            } else {
              withClue += 1;
              const clue = question.clues_available[0]!;
              if (!clue.fact_base_ids.every((id) => question.fact_base_ids.includes(id))) related += 1;
              await expect(notice).toHaveCount(0);
              if (mode === "assisted") {
                await expect(board.getByText(clue.text)).toBeVisible();
                await expect(clueButton).toHaveCount(0);
              } else {
                await expect(board.getByText(clue.text)).toHaveCount(0);
                const open = board.getByRole("button", { name: locale.clueButton(question.hint_cost) });
                await expect(open).toBeVisible();
                await open.click();
                await expect(board.getByText(clue.text)).toBeVisible();
                await expect(board.getByRole("button", { name: locale.opened })).toBeDisabled();
                cost = question.hint_cost;
              }
              if (shotDir && withClue === 1) {
                mkdirSync(shotDir, { recursive: true });
                await page.screenshot({ path: join(shotDir, `${locale.id}-${viewport.name}-${mode}-${scenario.name}-clue.png`) });
              }
            }
            const advance = await answerCorrectly(page, question, locale);
            if (question.clues_available.length > 0) {
              await board.getByRole("button", { name: locale.source }).click();
              const source = page.getByTestId("quiz-clue-source");
              await expect(source).toContainText(question.clues_available[0]!.text);
              await expect(source.locator("a").first()).toHaveAttribute("href", question.clues_available[0]!.evidence[0]!.source_url);
            }
            expectedScore += question.base_points - cost;
            await page.waitForTimeout(NEXT_GUARD_MS + 50);
            await advance.click();
            if (index < session.questions.length - 1) {
              await expect(board.locator(".quiz-hud .hud-item").filter({ hasText: /Pontos:|Score:/ }).locator("strong")).toHaveText(String(expectedScore));
            }
          }
          await expect(page.getByTestId("game-result")).toBeVisible();
          // Expert would be the third mode; here the scenario must prove both states.
          test.info().annotations.push({ type: "coverage", description: `${withClue} with clue (${related} cite the answer's own date), ${withoutClue} without` });
        });
      }

test.describe("a published session keeps its clue state after a reload", () => {
  for (const locale of locales) {
    test(`quiz ${locale.id}: the same artifact gives the same clue state after reload`, async ({ page, baseURL }) => {
      const firstLoad = await openSession(page, baseURL!, locale.path, "standard", "decade=2000");
      const first = await startAndMatch(page, firstLoad);
      await page.reload();
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      const secondLoad: QuizSession[] = [];
      page.on("response", async (response) => {
        if (/\/data\/(?:next\/)?session\.[^/]+\.json$/.test(response.url()) && response.ok()) secondLoad.push((await response.json()) as QuizSession);
      });
      await page.reload();
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      const second = await startAndMatch(page, secondLoad.length ? secondLoad : firstLoad);
      expect(second.session_id).toBe(first.session_id);
      const hasClue = second.questions[0]!.clues_available.length > 0;
      await expect(page.getByTestId("quiz-no-clue")).toHaveCount(hasClue ? 0 : 1);
    });
  }
});
