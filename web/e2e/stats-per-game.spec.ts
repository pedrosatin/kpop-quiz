import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";
const PLAYER_STATS_STORAGE_KEY = "kpop-player-stats-v1";

const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

/** Wait until StatsNavTrigger has hydrated so #stats-open-nav-btn onClick is attached. */
async function waitForStatsNavHydrated(page: Page) {
  const island = page.locator('astro-island[component-url*="StatsNavTrigger"]');
  await expect(island).toBeAttached();
  await expect(island).not.toHaveAttribute("ssr");
}

const PAGES = [
  { path: "/pt-br/", tab: "Quiz", rule: "Vitória: acertar pelo menos metade das perguntas (5 de 10)." },
  { path: "/pt-br/grid/", tab: "Grade", rule: "Vitória: preencher pelo menos 5 das 9 casas, sem desistir." },
  { path: "/pt-br/conexoes/", tab: "Conexões", rule: "Vitória: achar as 4 categorias antes do quarto erro." },
  { path: "/pt-br/adivinhe/", tab: "Adivinhe", rule: "Vitória: acertar o nome em até 6 palpites." },
  { path: "/pt-br/caca-palavras/", tab: "Caça-palavras", rule: "Vitória: achar todos os nomes, sem desistir." },
  { path: "/pt-br/mapa/", tab: "Mapa", rule: "Vitória: acertar o país de pelo menos metade das datas (5 de 10)." },
  { path: "/pt-br/linha-do-tempo/", tab: "Linha do Tempo", rule: "Vitória: pôr todos os acontecimentos na ordem certa, sem desistir." },
  { path: "/pt-br/codigo/", tab: "Código", rule: "Vitória: descobrir o código em até 10 tentativas." },
  { path: "/pt-br/cruzadinha/", tab: "Cruzadinha", rule: "Vitória: completar a grade com Verificar respostas, sem Revelar respostas." },
  { path: "/en/map/", tab: "Map", rule: "Win: get the country right for at least half the dates (5 of 10)." },
  { path: "/en/guess/", tab: "Guess", rule: "Win: guess the name in 6 tries or fewer." },
] as const;

for (const { path, tab, rule } of PAGES) {
  test(`${path}: statistics open on the game's tab with its win rule`, async ({ page }) => {
    await page.goto(`${base}${path}`);
    await waitForStatsNavHydrated(page);
    await page.locator("#stats-open-nav-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText(rule)).toBeVisible();
  });
}

for (const path of ["/pt-br/caca-palavras/", "/pt-br/conexoes/", "/en/timeline/"]) {
  test(`${path}: closing gives focus back to the stats button after a click that did not focus it`, async ({ page }) => {
    await page.goto(`${base}${path}`);
    await waitForStatsNavHydrated(page);
    const trigger = page.locator("#stats-open-nav-btn");
    const dialog = page.getByRole("dialog");
    const close = page.locator(".stats-modal-card .modal-close");
    // A scripted click, like a tap in Safari, opens the window without
    // focusing the button; focus stays on body or on a heading.
    for (const closeWith of ["Escape", "button", "backdrop"] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await trigger.dispatchEvent("click");
      await expect(dialog).toBeVisible();
      await expect(close).toBeFocused();
      if (closeWith === "Escape") await page.keyboard.press("Escape");
      else if (closeWith === "button") await close.click();
      else await page.locator(".modal-backdrop").click({ position: { x: 2, y: 2 } });
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });
}

test("390: statistics open on the Timeline tab with the page scrolled to the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/pt-br/linha-do-tempo/`);
  await waitForStatsNavHydrated(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // dispatchEvent does not scroll the header button into view first.
  await page.locator("#stats-open-nav-btn").dispatchEvent("click");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("tab", { name: "Linha do Tempo" })).toHaveAttribute("aria-selected", "true");
  const scrolled = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#stats-open-nav-btn")).toBeFocused();
  // Focus goes back without moving the page.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test("390: the Crossword tab, last in the list, is scrolled into view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/pt-br/cruzadinha/`);
  await waitForStatsNavHydrated(page);
  await page.locator("#stats-open-nav-btn").click();
  const tab = page.getByRole("dialog").getByRole("tab", { name: "Cruzadinha" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeInViewport({ ratio: 1 });
});

test("Name Guess: the guess distribution shows a loss bar", async ({ page }) => {
  await page.addInitScript((key) => {
    const zero = { played: 0, won: 0, currentStreak: 0, maxStreak: 0 };
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      overall: { played: 3, won: 1, currentStreak: 1, maxStreak: 1, lastPlayedDate: "2026-11-10" },
      games: {
        quiz: zero, grid: zero, connections: zero, "word-search": zero, timeline: zero, map: zero, code: zero, crossword: zero,
        "name-guess": {
          played: 3, won: 1, currentStreak: 0, maxStreak: 1, lastPlayedDate: "2026-11-10",
          guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, 6: 0 },
        },
      },
    }));
  }, PLAYER_STATS_STORAGE_KEY);
  await page.goto(`${base}/pt-br/adivinhe/`);
  await waitForStatsNavHydrated(page);
  await page.locator("#stats-open-nav-btn").click();
  const chart = page.getByRole("img", { name: /Palpites por partida/ });
  await expect(chart).toHaveAccessibleName("Palpites por partida: 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, 6: 0, Derrotas: 2");
  const lossRow = page.locator(".stats-distribution-row").last();
  await expect(lossRow.locator(".stats-attempt-num")).toHaveText("X");
  await expect(lossRow.locator(".stats-bar-fill.is-loss")).toHaveText("2");
});
