import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/consent";

const PLAYER_STATS_STORAGE_KEY = "kpop-player-stats-v1";
const base = process.env.ASTRO_BASE?.replace(/\/$/, "") ?? "";

const zero = { played: 0, won: 0, currentStreak: 0, maxStreak: 0 };

function statsWith(overall: Record<string, unknown>) {
  return {
    version: 1,
    overall,
    games: {
      quiz: { ...overall },
      grid: zero, connections: zero, "word-search": zero, timeline: zero, map: zero, code: zero, crossword: zero,
      "name-guess": { ...zero, guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
    },
  };
}

const LOCAL = statsWith({ played: 3, won: 1, currentStreak: 1, maxStreak: 1, lastPlayedDate: "2026-11-10" });
const FILE = statsWith({ played: 10, won: 8, currentStreak: 2, maxStreak: 4, lastPlayedDate: "2026-10-01" });

/** Wait until StatsNavTrigger has hydrated so #stats-open-nav-btn onClick is attached. */
async function waitForStatsNavHydrated(page: Page) {
  const island = page.locator('astro-island[component-url*="StatsNavTrigger"]');
  await expect(island).toBeAttached();
  await expect(island).not.toHaveAttribute("ssr");
}

function storedStats(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), PLAYER_STATS_STORAGE_KEY);
}

async function openStatsWithLocal(page: Page, path: string) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    PLAYER_STATS_STORAGE_KEY,
    JSON.stringify(LOCAL),
  ] as const);
  await page.goto(`${base}${path}`);
  await waitForStatsNavHydrated(page);
  await page.locator("#stats-open-nav-btn").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function pickStatsFile(page: Page, content: unknown) {
  await page.locator('.stats-modal-card input[type="file"]').setInputFiles({
    name: "kpop-quiz-stats.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(content)),
  });
}

test("pt-BR: picking a stats file asks first; Escape keeps local stats, confirming replaces them", async ({ page }) => {
  await openStatsWithLocal(page, "/pt-br/");
  const before = await storedStats(page);
  const dialog = page.getByRole("dialog");
  // The hidden file input carries the same name, so match the visible button by its text.
  const importButton = dialog.locator("button", { hasText: "Importar estatísticas" });

  await pickStatsFile(page, { ...FILE, exportedAt: "2026-10-01T12:00:00.000Z" });
  const confirm = page.getByRole("alertdialog", { name: "Substituir as estatísticas deste aparelho pelas do arquivo?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Arquivo exportado em 1 de outubro de 2026");
  await expect(confirm.getByRole("row", { name: /Partidas/ })).toHaveText(/Partidas\s*3\s*10/);
  await expect(confirm.getByRole("button", { name: "Cancelar" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(importButton).toBeFocused();
  expect(await storedStats(page)).toBe(before);

  await pickStatsFile(page, { ...FILE, exportedAt: "2026-10-01T12:00:00.000Z" });
  await confirm.getByRole("button", { name: "Substituir estatísticas" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText("Estatísticas importadas.");
  await expect(importButton).toBeFocused();
  expect(JSON.parse((await storedStats(page)) ?? "{}").overall).toEqual(FILE.overall);
});

test("en: a file from before exportedAt says the export date is unknown, and Cancel keeps local stats", async ({ page }) => {
  await openStatsWithLocal(page, "/en/");
  const before = await storedStats(page);

  await pickStatsFile(page, FILE);
  const confirm = page.getByRole("alertdialog", { name: "Replace the stats on this device with the ones in the file?" });
  await expect(confirm).toContainText("The file has no export date.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(await storedStats(page)).toBe(before);
});

test("pt-BR: a file dated after today is refused without asking", async ({ page }) => {
  await openStatsWithLocal(page, "/pt-br/");
  const before = await storedStats(page);

  await pickStatsFile(page, statsWith({ played: 1, won: 1, currentStreak: 1, maxStreak: 1, lastPlayedDate: "9999-12-31" }));
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("O arquivo não está no formato esperado.");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await storedStats(page)).toBe(before);
});
