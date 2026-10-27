import { expect, test } from "./fixtures/consent";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const locales = [
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

for (const locale of locales) {
  test(`${locale.id} quiz: cancel keeps the round and confirm ends it`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${base}${locale.quizPath}`);
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
    const origin = new URL(baseURL!).origin;
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}${locale.gridPath}`);

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
