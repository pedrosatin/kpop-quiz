import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { serveFixedStrands } from "./helpers/fixed-daily";
import { joinBaseUrl } from "../src/lib/join-base-url";

test.use({ bypassCSP: true });

const axeScript = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const evidenceDir = process.env.STRANDS_EVIDENCE_DIR;

const routes = [
  { locale: "pt-BR" as const, path: "/pt-br/palavras-conectadas/" },
  { locale: "en" as const, path: "/en/strands/" },
] as const;

async function audit(page: Page) {
  await page.addScriptTag({ content: axeScript });
  const violations = await page.evaluate(async () => {
    const engine = (
      window as unknown as {
        axe: {
          run(
            root: Document,
            options: unknown,
          ): Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const result = await engine.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    }));
  });
  expect(violations).toEqual([]);
}

async function capture(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: join(evidenceDir, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

for (const route of routes) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`strands ${route.locale} ${colorScheme}: axe has 0 violations`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => {
        window.localStorage.setItem("kpop-quiz-consent", "rejected");
      });
      await serveFixedStrands(page);
      await page.goto(joinBaseUrl(baseURL!, route.path));
      await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await audit(page);
      if (route.locale === "pt-BR" && colorScheme === "light") {
        await capture(page, "strands-390-light");
      }
      if (route.locale === "en" && colorScheme === "dark") {
        await capture(page, "strands-390-dark-en");
      }
    });
  }
}

test("strands 390 and 1440 keep grid, answer area and actions without page scroll", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("kpop-quiz-consent", "rejected");
  });
  await serveFixedStrands(page);

  for (const viewport of [
    { width: 390, height: 844, label: "390" },
    { width: 1440, height: 900, label: "1440" },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(joinBaseUrl(baseURL!, "/pt-br/palavras-conectadas/"));
    await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);

    const layout = await page.evaluate(() => {
      const grid = document.querySelector(".word-search-grid")?.getBoundingClientRect();
      const list = document.querySelector(".strands-list, .word-search-list")?.getBoundingClientRect();
      const actions = document.querySelector(".word-search-actions, .game-actions")?.getBoundingClientRect();
      const doc = document.documentElement;
      return {
        grid: grid ? { top: grid.top, bottom: grid.bottom } : null,
        list: list ? { top: list.top, bottom: list.bottom } : null,
        actions: actions ? { top: actions.top, bottom: actions.bottom } : null,
        scrollHeight: doc.scrollHeight,
        clientHeight: doc.clientHeight,
        innerHeight: window.innerHeight,
      };
    });

    expect(layout.grid, `${viewport.label}: grid`).not.toBeNull();
    expect(layout.actions, `${viewport.label}: actions`).not.toBeNull();
    expect(layout.grid!.top).toBeGreaterThanOrEqual(-1);
    expect(layout.grid!.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);
    expect(layout.actions!.top).toBeGreaterThanOrEqual(-1);
    expect(layout.actions!.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);
    if (layout.list) {
      expect(layout.list.top).toBeGreaterThanOrEqual(-1);
      expect(layout.list.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);
    }

    await capture(page, `strands-ux-${viewport.label}`);
  }
});
