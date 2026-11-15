import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/consent";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { quizProgressStorageKey } from "../src/components/Quiz/storage";
import { joinBaseUrl } from "../src/lib/join-base-url";
import type { Locale } from "../src/lib/quiz-types";
import { gamePlayed } from "./helpers/player-stats";
import { skipUnlessPublished } from "./helpers/published";

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

test.beforeEach(async ({ page, baseURL }) => {
  await skipUnlessPublished(page, baseURL!, "manifest-v2.json");
  const manifest = await (await page.request.get(joinBaseUrl(baseURL!, "/data/manifest-v2.json"))).json();
  const entry = manifest.sessions["daily.pt-BR.standard"];
  test.skip(!entry, "the day was published without the daily quiz");
  const session = await (await page.request.get(joinBaseUrl(baseURL!, `/data/${entry.path}`))).json();
  const date = /^kpop-daily-(\d{4}-\d{2}-\d{2})$/.exec(session.config.seed)?.[1];
  test.skip(!date, "the daily session has no dated seed");
  await page.clock.setFixedTime(new Date(`${date}T15:00:00Z`));
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
    await page.waitForTimeout(NEXT_GUARD_MS + 50);
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

    // The same result after a reload, and the general quiz still plays.
    await page.reload();
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
    await skipUnlessPublished(page, baseURL!, "manifest-v2.json", "catalog-manifest-v1.json");
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
