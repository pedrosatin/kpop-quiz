import { expect, test } from "./fixtures/consent";
import { routeCrosswordDaily } from "./helpers/crossword-daily";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

type LocaleCopy = {
  id: string;
  giveUp: string;
  confirm: string;
  cancel: string;
  title: string;
  reveal?: string;
  confirmReveal?: string;
  revealTitle?: string;
};

const locales: LocaleCopy[] = [
  {
    id: "pt",
    giveUp: "Desistir",
    confirm: "Sim, desistir",
    cancel: "Cancelar",
    title: "Desistir da partida?",
    reveal: "Revelar respostas",
    confirmReveal: "Sim, revelar",
    revealTitle: "Revelar as respostas?",
  },
  {
    id: "en",
    giveUp: "Give up",
    confirm: "Yes, give up",
    cancel: "Cancel",
    title: "Give up this game?",
    reveal: "Reveal answers",
    confirmReveal: "Yes, reveal",
    revealTitle: "Reveal the answers?",
  },
];

const quizLocales = [
  {
    id: "pt",
    quizPath: "/pt-br/",
    gridPath: "/pt-br/grid/",
    start: "Começar partida",
    giveUp: "Desistir",
    confirm: "Sim, desistir",
    cancel: "Cancelar",
    title: "Desistir da partida?",
    result: "Fim da partida",
  },
  {
    id: "en",
    quizPath: "/en/",
    gridPath: "/en/grid/",
    start: "Start game",
    giveUp: "Give up",
    confirm: "Yes, give up",
    cancel: "Cancel",
    title: "Give up this game?",
    result: "Game over",
  },
] as const;

async function openBoard(
  page: import("@playwright/test").Page,
  baseURL: string,
  path: string,
  viewport = { width: 390, height: 844 },
) {
  const origin = new URL(baseURL).origin;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  // The build publishes no daily crossword; the audited board stands in as today's.
  await routeCrosswordDaily(page);
  await page.setViewportSize(viewport);
  await page.goto(`${base}${path}`);
}

for (const locale of quizLocales) {
  test(`${locale.id} quiz: cancel keeps the round and confirm ends it`, async ({ page, baseURL }) => {
    await openBoard(page, baseURL!, locale.quizPath, { width: 360, height: 800 });
    await page.getByTestId("game-start").click();
    await expect(page.getByTestId("game-board")).toBeVisible();

    await page.getByRole("button", { name: locale.giveUp }).click();
    const dialog = page.getByRole("dialog", { name: locale.title });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: locale.cancel }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("game-board")).toBeVisible();
    await expect(page.getByRole("heading", { name: locale.result })).toHaveCount(0);

    await page.getByRole("button", { name: locale.giveUp }).click();
    await page.getByRole("button", { name: locale.confirm }).click();
    await expect(page.getByRole("heading", { name: locale.result })).toBeVisible();
  });

  test(`${locale.id} grid: Escape keeps the board and confirm reveals answers`, async ({ page, baseURL }) => {
    await openBoard(page, baseURL!, locale.gridPath);
    const board = page.getByTestId("game-board");
    const missing = page.getByTestId("game-missing");
    await expect(board.or(missing)).toBeVisible();
    if (await missing.isVisible()) {
      test.skip(true, "grid.daily.json absent in this build");
      return;
    }

    await page.getByRole("button", { name: locale.giveUp }).click();
    const dialog = page.getByRole("dialog", { name: locale.title });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: locale.giveUp })).toBeVisible();

    await page.getByRole("button", { name: locale.giveUp }).click();
    await page.getByRole("button", { name: locale.confirm }).click();
    await expect(page.locator(".grid-result")).toBeVisible();
  });
}

const remainingGiveUpGames = [
  { name: "connections", paths: { pt: "/pt-br/conexoes/", en: "/en/connections/" } },
  { name: "name-guess", paths: { pt: "/pt-br/adivinhe/", en: "/en/guess/" } },
  { name: "timeline", paths: { pt: "/pt-br/linha-do-tempo/", en: "/en/timeline/" } },
  { name: "map", paths: { pt: "/pt-br/mapa/", en: "/en/map/" } },
  { name: "word-search", paths: { pt: "/pt-br/caca-palavras/", en: "/en/word-search/" } },
] as const;

for (const locale of locales) {
  for (const game of remainingGiveUpGames) {
    const path = game.paths[locale.id as "pt" | "en"];
    test(`${locale.id} ${game.name}: cancel keeps play and confirm ends it`, async ({ page, baseURL }) => {
      await openBoard(page, baseURL!, path);
      const board = page.getByTestId("game-board");
      const missing = page.getByTestId("game-missing");
      await expect(board.or(missing)).toBeVisible();
      if (await missing.isVisible()) {
        test.skip(true, `${game.name} artifact absent in this build`);
        return;
      }

      await page.getByRole("button", { name: locale.giveUp }).click();
      const dialog = page.getByRole("dialog", { name: locale.title });
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: locale.cancel }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: locale.giveUp })).toBeVisible();
      await expect(page.getByTestId("game-result")).toHaveCount(0);

      await page.getByRole("button", { name: locale.giveUp }).click();
      await page.getByRole("button", { name: locale.confirm }).click();
      await expect(page.getByTestId("game-result")).toBeVisible();
    });
  }

  test(`${locale.id} crossword: cancel keeps the board and confirm reveals answers`, async ({ page, baseURL }) => {
    const path = locale.id === "pt" ? "/pt-br/cruzadinha/" : "/en/crossword/";
    await openBoard(page, baseURL!, path);
    const board = page.getByTestId("game-board");
    const missing = page.getByTestId("game-missing");
    await expect(board.or(missing)).toBeVisible();
    if (await missing.isVisible()) {
      test.skip(true, "crossword artifact absent in this build");
      return;
    }

    await page.getByRole("button", { name: locale.reveal! }).click();
    const dialog = page.getByRole("dialog", { name: locale.revealTitle! });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: locale.cancel }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: locale.reveal! })).toBeVisible();
    await expect(page.getByTestId("game-result")).toHaveCount(0);

    await page.getByRole("button", { name: locale.reveal! }).click();
    await page.getByRole("button", { name: locale.confirmReveal! }).click();
    await expect(page.getByTestId("game-result")).toBeVisible();
  });
}
