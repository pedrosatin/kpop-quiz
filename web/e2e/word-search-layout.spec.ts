import { test, expect, type Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { loadPreferNextDaily } from "./helpers/daily-artifact";
import { reloadPersisted } from "./helpers/passive-effects";

interface Daily {
  reference_date: string;
  words: { start_row: number; start_col: number; end_row: number; end_col: number }[];
}

async function expectContained(page: Page) {
  const geometry = await page.locator(".word-search-actions").evaluate((bar) => {
    const bounds = bar.getBoundingClientRect();
    const elements = [...bar.querySelectorAll("button, dd, .word-search-message:not(.visually-hidden)")];
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      contained: elements.every((element) => {
        const r = element.getBoundingClientRect();
        return r.left >= bounds.left && r.right <= bounds.right;
      }),
      sticky: getComputedStyle(bar).position,
      messageFits: [...bar.querySelectorAll(".word-search-message:not(.visually-hidden) p")]
        .every((p) => p.clientWidth > 0 && p.scrollHeight <= p.clientHeight + 1),
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.contained).toBe(true);
  expect(geometry.messageFits).toBe(true);
  expect(geometry.sticky).toBe("sticky");
}

for (const locale of ["pt", "en"]) {
  for (const [width, height] of [[360, 800], [390, 844], [1280, 800]] as const) {
    for (const consent of ["open", "rejected"]) {
      test(`${locale} ${width} consent ${consent}: actions, progress and results stay contained`, async ({ browser, baseURL }, testInfo) => {
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500, permissions: ["clipboard-read", "clipboard-write"] });
        await context.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
        if (consent === "rejected") await context.addInitScript(() => localStorage.setItem("kpop-quiz-consent", "rejected"));
        const page = await context.newPage();
        try {
          await page.goto(joinBaseUrl(baseURL!, locale === "pt" ? "/pt-br/caca-palavras/" : "/en/word-search/"));
          await expect(page.locator(".word-search-cell").first()).toBeVisible();
          // Staging deliberately omits the consent island; exercise the same game
          // there, and require the real banner whenever the build enables it.
          const consentEnabled = await page.locator("[data-consent-preferences]").count() > 0;
          if (consent === "open" && consentEnabled) await expect(page.locator(".consent-banner")).toBeVisible();
          else await expect(page.locator(".consent-banner")).toHaveCount(0);
          await expectContained(page);
          await page.locator(".how-to-play > summary").click();
          await expect(page.locator(".how-to-play")).toHaveAttribute("open", "");
          await page.locator(".how-to-play > summary").click();
          const puzzle = await loadPreferNextDaily<Daily>(page.request, baseURL!, "word-search.daily.json");
          const select = async (index: number) => {
            const word = puzzle.words[index]!;
            for (const [row, col] of [[word.start_row, word.start_col], [word.end_row, word.end_col]]) {
              const cell = page.locator(`.word-search-cell[data-row="${row}"][data-col="${col}"]`);
              await cell.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
              const uncovered = await cell.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
              });
              expect(uncovered, "cell must remain reachable above the sticky bar and consent").toBe(true);
              if (width < 500) await cell.tap(); else await cell.click();
            }
          };
          await select(0);
          await expect(page.getByTestId("found-counter")).toContainText("1");
          await reloadPersisted(page);
          await expect(page.getByTestId("found-counter")).toContainText("1");
          await page.locator(".toggle-mode-btn").click();
          await expectContained(page);
          await page.screenshot({ path: testInfo.outputPath("progress.png") });
          for (let i = 1; i < puzzle.words.length; i++) await select(i);
          await expect(page.getByTestId("game-result")).toBeVisible();
          await expectContained(page);
          await reloadPersisted(page);
          await expect(page.getByTestId("game-result")).toBeVisible();
          await expectContained(page);
          await page.locator(".word-search-result-buttons > button").first().click();
          await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
            locale === "pt" ? "Caça-palavras de K-pop" : "K-pop Word Search",
          );
          await page.screenshot({ path: testInfo.outputPath("victory.png") });
          await context.clearCookies();
          await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("kpop-word-search-")).forEach((key) => localStorage.removeItem(key)));
          await reloadPersisted(page);
          await page.locator(".word-search-actions > button").click();
          await page.getByRole("button", { name: /Sim, desistir|Yes, give up/ }).click();
          await expect(page.getByTestId("game-result")).toBeVisible();
          await expectContained(page);
          await page.screenshot({ path: testInfo.outputPath("gave-up.png") });
        } finally {
          await context.close();
        }
      });
    }
  }
}
