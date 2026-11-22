import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/consent";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { buildQuizProgressSave, quizProgressStorageKey } from "../src/components/Quiz/storage";
import { joinBaseUrl } from "../src/lib/join-base-url";
import type { Locale } from "../src/lib/quiz-types";
import { gamePlayed } from "./helpers/player-stats";
import { crossGuard } from "./helpers/guard-clock";
import { fixedQuizSession, serveFixedQuiz } from "./helpers/fixed-daily";

/**
 * Playtest 2026-11-11, bugs 4 and 5. A daily quiz finished today opens its
 * result, not a second round of the same day, and the general quiz stays one
 * tap away. A round left in progress in one language is announced on the
 * other language's setup with a link back to it, and nothing is deleted.
 * The clock is pinned to the published daily session's date, so the main
 * data/ session is today's challenge.
 */

const SHOTS = process.env.QUIZ_DAILY_SHOTS_DIR;

const copy = {
  "pt-BR": {
    path: "/pt-br/",
    submit: "Responder",
    next: /Próxima pergunta|Ver resultado/,
    result: "Fim da partida",
    playGeneral: "Jogar o Quiz geral",
    openSetup: "Montar partida",
    setupKicker: "Antes de começar",
    generalNote: (question: number) => `Você parou na pergunta ${question} de 10. Escolha para continuar.`,
    daily: /Quiz do dia/,
    doneNotice: "Você já concluiu o Quiz do dia de hoje. Este é o resultado salvo, e ele conta uma vez nas estatísticas.",
    countdown: /^Novo desafio em \d{2}:\d{2}:\d{2}$/,
    resume: "Continue in Portuguese",
    otherNotice: (question: number) =>
      `You have a general quiz in progress in Portuguese, at question ${question} of 10. Starting a game here does not delete it.`,
    question: (n: number) => `Pergunta ${n} de 10`,
  },
  en: {
    path: "/en/",
    submit: "Submit answer",
    next: /Next question|See results/,
    result: "Game over",
    playGeneral: "Play the general quiz",
    openSetup: "Set up a round",
    setupKicker: "Before you start",
    generalNote: (question: number) => `You stopped at question ${question} of 10. Pick it to continue.`,
    daily: /Daily quiz/,
    doneNotice: "You already finished today's daily quiz. This is your saved result, and it counts once in your stats.",
    countdown: /^New puzzle in \d{2}:\d{2}:\d{2}$/,
    resume: "Continuar em inglês",
    otherNotice: (question: number) =>
      `Você tem um Quiz geral em andamento em inglês, na pergunta ${question} de 10. Começar uma partida aqui não apaga a outra.`,
    question: (n: number) => `Question ${n} of 10`,
  },
} as const;

const other = (locale: Locale): Locale => (locale === "pt-BR" ? "en" : "pt-BR");
const id = (locale: Locale) => (locale === "pt-BR" ? "pt" : "en");

test.beforeEach(async ({ page }) => {
  const session = fixedQuizSession("daily.pt-BR.standard");
  const date = /^kpop-daily-(\d{4}-\d{2}-\d{2})$/.exec(session.config.seed)?.[1];
  expect(date, "the frozen daily session has a dated seed").toBeTruthy();
  // Serve after the clock so the frozen day matches the session seed.
  await serveFixedQuiz(page, { instant: new Date(`${date}T15:00:00Z`) });
  await page.setViewportSize({ width: 360, height: 800 });
});

async function answer(page: Page, locale: Locale, count: number) {
  const board = page.getByTestId("game-board");
  for (let i = 0; i < count; i += 1) {
    await expect(board).toBeVisible();
    await board.locator("label.option").first().click();
    await board.getByRole("button", { name: copy[locale].submit }).click();
    const advance = board.getByRole("button", { name: copy[locale].next });
    await expect(advance).toBeVisible();
    await crossGuard(page, NEXT_GUARD_MS + 50);
    await advance.click();
  }
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

const slot = (locale: Locale, theme: "daily" | "history") =>
  quizProgressStorageKey({ locale, playMode: "standard", theme, decades: [] });

const readSlot = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);

for (const locale of ["pt-BR", "en"] as const) {
  const t = copy[locale];

  test(`a finished daily quiz opens its result, not a second round (${id(locale)})`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.goto(joinBaseUrl(baseURL!, `${t.path}?theme=daily&mode=standard`));
    await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("game-start").click();
    await answer(page, locale, 10);
    const result = page.getByTestId("game-result");
    await expect(result.getByRole("heading", { name: t.result })).toBeVisible();
    // The quiz records the match in an effect, after the result is painted.
    // On a busy machine the heading can be visible before the write.
    await expect.poll(() => gamePlayed(page, "quiz"), { message: "the finished daily quiz counts once" }).toBe(1);
    const daySave = await readSlot(page, slot(locale, "daily"));
    expect(daySave).not.toBeNull();

    // Back to the setup through the general quiz, then the daily card again.
    await result.getByRole("button", { name: t.playGeneral }).click();
    await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("theme")).toBe("history");
    // The card's label covers its radio, as a tap on the card does.
    await page.getByRole("radio", { name: t.daily }).locator("xpath=ancestor::label").click();

    await expect(result.getByRole("heading", { name: t.result })).toBeVisible();
    await expect(result.getByText(t.doneNotice)).toBeVisible();
    await expect(result.getByText(t.countdown)).toBeVisible();
    await expect(page.getByTestId("game-start")).toHaveCount(0);
    await expect(page.getByTestId("game-board")).toHaveCount(0);
    expect(await gamePlayed(page, "quiz")).toBe(1);
    expect(await readSlot(page, slot(locale, "daily"))).toBe(daySave);

    // The same result after a reload, with a general round left in progress.
    const generalSession = fixedQuizSession(`${locale}.standard`);
    const generalSave = buildQuizProgressSave({
      session: generalSession,
      sessionSource: "published",
      locale,
      playMode: "standard",
      theme: "history",
      decades: [],
      timerEnabled: false,
      machineState: "question.ready",
      questionIndex: 3,
      selectedId: null,
      timedOut: false,
      score: 0,
      revealedClues: [],
      history: generalSession.questions.slice(0, 3).map((question) => ({
        question,
        selectedOptionId: question.options[0]!.id,
        isCorrect: false,
        cluesUsedCount: 0,
      })),
      questionDeadlineMs: null,
      startedAtMs: Date.now() - 60_000,
      elapsedSeconds: 60,
      gaveUp: false,
      replayNotice: "ok",
    });
    await page.evaluate(
      ({ key, raw }) => window.localStorage.setItem(key, raw),
      { key: slot(locale, "history"), raw: JSON.stringify(generalSave) },
    );
    await page.reload();
    await expect(page.getByTestId("game-result").getByText(t.doneNotice)).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("quiz-daily-done-general-note")).toHaveText(t.generalNote(4));
    const openSetup = page.getByTestId("quiz-open-setup");
    await expect(openSetup).toHaveText(t.openSetup);
    const openBox = (await openSetup.boundingBox())!;
    expect(openBox.height).toBeGreaterThanOrEqual(44);
    expect(openBox.y).toBeGreaterThanOrEqual(0);
    expect(openBox.y + openBox.height).toBeLessThanOrEqual(844);
    await openSetup.click();
    await expect(page.getByTestId("game-setup")).toBeVisible({ timeout: 30_000 });
    const kicker = page.locator(".quiz-setup .kicker");
    await expect(kicker).toHaveText(t.setupKicker);
    const kickerBox = (await kicker.boundingBox())!;
    expect(kickerBox.y).toBeGreaterThanOrEqual(0);
    expect(kickerBox.y + kickerBox.height).toBeLessThanOrEqual(844);

    // Drop the seeded general save so "Jogar o Quiz geral" opens a fresh setup.
    await page.evaluate((key) => window.localStorage.removeItem(key), slot(locale, "history"));
    await page.goto(joinBaseUrl(baseURL!, `${t.path}?theme=daily&mode=standard`));
    await expect(page.getByTestId("game-result").getByText(t.doneNotice)).toBeVisible({ timeout: 30_000 });
    const general = page.getByTestId("quiz-play-general");
    const box = (await general.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await shot(page, `360-${id(locale)}-diario-concluido`);
    await general.click();
    await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("game-start").click();
    await expect(page.getByTestId("game-board")).toBeVisible();
    expect(await gamePlayed(page, "quiz")).toBe(1);
  });

  test(`switching language mid-round offers the round back (${id(locale)} to ${id(other(locale))})`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await serveFixedQuiz(page, { hideCatalog: false });
    await page.goto(joinBaseUrl(baseURL!, `${t.path}?theme=history&mode=standard`));
    await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("game-start").click();
    await answer(page, locale, 2);
    await expect(page.getByTestId("game-board").getByText(t.question(3))).toBeVisible();
    const saved = await readSlot(page, slot(locale, "history"));
    expect(saved).not.toBeNull();

    // Record where Start sits on every frame from the first paint: the
    // notice arrives after hydration and must not move it. Sampling has no
    // time limit, because on a busy machine the first frame of the new page
    // can come after several seconds.
    await page.addInitScript(() => {
      const w = window as unknown as { __startTops: number[] };
      w.__startTops = [];
      const sample = () => {
        const start = document.querySelector('[data-testid="game-start"]');
        if (start) w.__startTops.push(Math.round(start.getBoundingClientRect().top));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator(".language-link").click();
    const there = copy[other(locale)];
    await expect(page).toHaveURL(new RegExp(`${there.path.replace(/\//g, "\\/")}\\?`));
    const notice = page.getByTestId("quiz-other-locale-round");
    await expect(notice).toHaveText(new RegExp(t.otherNotice(3).replace(/[.?]/g, "\\$&")), { timeout: 30_000 });
    await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
    const startTops = await page.evaluate(() => (window as unknown as { __startTops: number[] }).__startTops);
    expect(startTops.length, "frames sampled since the first paint").toBeGreaterThan(0);
    expect(new Set(startTops).size, `Start moved: ${[...new Set(startTops)].join(", ")}`).toBe(1);
    const setupBox = (await page.getByTestId("game-setup").boundingBox())!;
    const noticeBox = (await notice.boundingBox())!;
    expect(noticeBox.y).toBeGreaterThanOrEqual(setupBox.y + setupBox.height);
    const resume = notice.getByRole("link", { name: t.resume });
    expect((await resume.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await notice.scrollIntoViewIfNeeded();
    await shot(page, `360-${id(other(locale))}-aviso-partida-em-${id(locale)}`);
    expect(await readSlot(page, slot(locale, "history"))).toBe(saved);

    await resume.click();
    await expect(page.getByTestId("game-board").getByText(t.question(3))).toBeVisible({ timeout: 30_000 });
    expect(await readSlot(page, slot(locale, "history"))).toBe(saved);
  });
}
