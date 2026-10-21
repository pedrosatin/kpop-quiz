import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

test.use({ bypassCSP: true });

const prefix = (process.env.ASTRO_BASE ?? new URL(process.env.BASE_URL ?? "http://127.0.0.1:4321").pathname).replace(/\/$/, "");
const evidenceDir = process.env.PILOT_EVIDENCE_DIR;
const axeScript = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const crossword = JSON.parse(readFileSync(new URL("../public/data/crossword-pilot.json", import.meta.url), "utf8"));
const code = JSON.parse(readFileSync(new URL("../public/data/code-groups.pilot.json", import.meta.url), "utf8"));
const games = [
  { id: "crossword", pt: "/pt-br/cruzadinha/", en: "/en/crossword/", controls: "#crossword input" },
  { id: "code", pt: "/pt-br/codigo/", en: "/en/code/", controls: "#code-groups select" },
] as const;

// The code game is a daily game now: its artifact is code-groups.daily.json,
// which the local build may not hold, so the suite serves the committed pilot
// artifact (same contract) through route interception.
async function serveCodeArtifact(page: Page) {
  await page.route("**/data/code-groups.daily.json", (request) => request.fulfill({ json: code }));
  await page.route("**/data/next/code-groups.daily.json", (request) => request.fulfill({ status: 404, body: "" }));
}

async function audit(page: Page) {
  await page.addScriptTag({ content: axeScript });
  const violations = await page.evaluate(async () => {
    const engine = (window as unknown as { axe: { run(root: Document, options: unknown): Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await engine.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function rejectMobileCrosswordConsent(page: Page) {
  const banner = page.locator(".consent-banner");
  if (await banner.count() === 0) return;
  await expect(banner).toBeVisible();
  await expect(page.locator(".crossword-actions")).toHaveCSS("position", "static");
  await banner.getByRole("button", { name: /^(Recusar|Reject) Google Analytics$/ }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".crossword-actions")).toHaveCSS("position", "sticky");
}

async function capture(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true, animations: "disabled" });
}

for (const game of games) for (const locale of ["pt", "en"] as const)
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }])
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${game.id} ${locale} ${viewport.width} ${colorScheme}: layout and accessible controls`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme });
        const errors: string[] = [];
        page.on("pageerror", e => errors.push(e.message));
        if (game.id === "code") await serveCodeArtifact(page);
        await page.goto(prefix + game[locale]);
        await expect(page.locator(game.controls)).toHaveCount(game.id === "code" ? 4 : crossword.cells.length);
        await page.evaluate(() => document.fonts.ready);
        await audit(page);
        // Shared .how-to-play summary is 36px on fine pointers by design; the
        // game controls stay at the 44px touch target.
        const smallTargets = await page.locator(`${game.controls}, .crossword-actions button, .crossword-clues button, #code-groups button`).evaluateAll(elements =>
          elements.filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(e => e.outerHTML));
        expect(smallTargets).toEqual([]);
        if (locale === "pt" && viewport.width === 390) await capture(page, `${game.id}-mobile-${colorScheme}`);
        if (locale === "pt" && viewport.width === 320 && colorScheme === "light") await capture(page, `${game.id}-small-320`);
        if (locale === "en" && viewport.width === 1440) await capture(page, `${game.id}-desktop-${colorScheme}`);
        await page.getByText(locale === "pt" ? "Como jogar" : "How to play", { exact: true }).click();
        await expect(page.locator("details")).toHaveAttribute("open", "");
        // The open steps push the grid under the sticky action bar, which by
        // design overlaps the end of a board taller than the screen; audit the
        // grid as the player sees it after scrolling to it.
        if (game.id === "crossword") await page.locator(".crossword-board").evaluate(e => e.scrollIntoView({ block: "start" }));
        await audit(page);
        if (game.id === "crossword" && viewport.width <= 390) await rejectMobileCrosswordConsent(page);
        await page.getByText(locale === "pt" ? "Como jogar" : "How to play", { exact: true }).click();
        expect(errors).toEqual([]);
      });
    }

for (const game of games) test(`${game.id}: 200 percent text reflow and keyboard entry`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  if (game.id === "code") await serveCodeArtifact(page);
  await page.goto(prefix + game.en);
  await expect(page.locator(game.controls)).not.toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await audit(page);
  if (game.id === "crossword") {
    // The sticky bar may cover the end of the board at 200% text, like every
    // game; the main action must still be reachable and on screen.
    const check = page.getByRole("button", { name: "Check answers", exact: true });
    await check.scrollIntoViewIfNeeded();
    await expect(check).toBeInViewport();
    await rejectMobileCrosswordConsent(page);
    await expect(page.locator(".crossword-actions")).toHaveCSS("position", "sticky");
  }
  await capture(page, `${game.id}-text-200-percent`);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(game.id === "code" ? "#code-groups$" : "#crossword$"));
  await expect(page.locator(game.id === "code" ? "#code-groups" : "#crossword")).toBeFocused();
});

test("crossword: keyboard completion announces and focuses cited results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(prefix + games[0].pt);
  await expect(page.locator("#crossword input")).toHaveCount(crossword.cells.length);
  for (const entry of crossword.entries) {
    const clue = page.getByRole("button", { name: new RegExp(`^${entry.number} ${entry.direction === "across" ? "Horizontal" : "Vertical"}:`) });
    await clue.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type(entry.answer);
  }
  await page.getByRole("button", { name: "Verificar respostas", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Cruzadinha concluída!" })).toBeFocused();
  await rejectMobileCrosswordConsent(page);
  await expect(page.locator(".crossword-actions")).toHaveCSS("position", "sticky");
  await page.getByRole("button", { name: "Ver fonte" }).click();
  await expect(page.locator(".crossword-actions")).toHaveCSS("position", "static");
  await audit(page);
  await capture(page, "crossword-completed-dark");
});

test("code: feedback, keyboard victory and cited result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await serveCodeArtifact(page);
  await page.goto(prefix + games[1].pt);
  await expect(page.locator("#code-groups select")).toHaveCount(4);
  await page.getByRole("button", { name: "Enviar palpite" }).click();
  await expect(page.getByRole("status")).toContainText("Nenhuma tentativa usada");
  await audit(page);
  await capture(page, "code-incomplete-feedback");
  for (let index = 0; index < 4; index++) await page.locator("#code-groups select").nth(index).selectOption(code.secret[index]);
  await page.getByRole("button", { name: "Enviar palpite" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("game-result")).toBeFocused();
  await audit(page);
  await capture(page, "code-completed-light");
});

for (const game of games) test(`${game.id}: unavailable artifact keeps keyboard retry and skip target`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.route(game.id === "code" ? "**/data/code-groups.daily.json" : "**/data/crossword-pilot.json", route => route.fulfill({ status: 404, body: "" }));
  if (game.id === "code") await page.route("**/data/next/code-groups.daily.json", route => route.fulfill({ status: 404, body: "" }));
  await page.goto(prefix + game.pt);
  if (game.id === "code") await expect(page.getByTestId("game-missing")).toBeVisible();
  else await expect(page.getByTestId("game-missing")).toBeVisible();
  await audit(page);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(game.id === "code" ? "#code-groups$" : "#crossword$"));
  await expect(page.locator(game.id === "code" ? "#code-groups" : "#crossword")).toBeFocused();
  await capture(page, `${game.id}-missing-artifact`);
});
