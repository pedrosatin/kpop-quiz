import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { serveFixedStrands } from "./helpers/fixed-daily";
import { measureStrandsLayout, type StrandsLayoutMetrics } from "./helpers/strands-layout";
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

/** 390×844 and 1440×900: whole grid above the sticky bar (UX contract item 1). */
function expectPlayableLayout(layout: StrandsLayoutMetrics, label: string) {
  expect(layout.lastRowBottom, `${label}: last grid row`).not.toBeNull();
  expect(layout.actionsTop, `${label}: actions bar`).not.toBeNull();
  expect(layout.lastRowBottom!, `${label}: last row above the bar`).toBeLessThanOrEqual(layout.actionsTop! + 0.5);
  expect(layout.maxButtonRight, `${label}: action buttons`).not.toBeNull();
  expect(layout.maxButtonRight!, `${label}: buttons stay inside the page`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.buttonsOverlap, `${label}: action buttons do not overlap`).toBe(false);
  expect(layout.anyButtonTextClipped, `${label}: action button labels fully visible`).toBe(false);
  expect(layout.minButtonHeight, `${label}: button height`).not.toBeNull();
  expect(layout.minButtonHeight!, `${label}: buttons at least 44px tall`).toBeGreaterThanOrEqual(44 - 0.5);
  expect(layout.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.messageLines, `${label}: bar text at most 2 lines`).toBeLessThanOrEqual(2);
  expect(layout.themeTop, `${label}: theme visible`).toBeGreaterThanOrEqual(-1);
  expect(layout.themeBottom!, `${label}: theme above the bar`).toBeLessThanOrEqual((layout.actionsTop ?? layout.innerHeight) + 0.5);
  if (layout.kickerLeft !== null) {
    expect(layout.kickerLeft, `${label}: kicker not clipped on the left`).toBeGreaterThanOrEqual(-0.5);
  }
}

/** 360×740 without banner: top of the board above the bar; cell keeps the phone floor. */
function expectShortViewportLayout(layout: StrandsLayoutMetrics, label: string) {
  expect(layout.firstRowTop, `${label}: first grid row`).not.toBeNull();
  expect(layout.actionsTop, `${label}: actions bar`).not.toBeNull();
  expect(layout.firstRowTop!, `${label}: top of the board above the bar`).toBeLessThan(
    (layout.actionsTop ?? layout.innerHeight) + 0.5,
  );
  expect(layout.cellSize, `${label}: cell size`).not.toBeNull();
  expect(layout.cellSize!, `${label}: cell at least Word Search phone floor (1.625rem)`).toBeGreaterThanOrEqual(
    layout.cellMinPx - 0.5,
  );
  expect(layout.maxButtonRight, `${label}: action buttons`).not.toBeNull();
  expect(layout.maxButtonRight!, `${label}: buttons stay inside the page`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.buttonsOverlap, `${label}: action buttons do not overlap`).toBe(false);
  expect(layout.anyButtonTextClipped, `${label}: action button labels fully visible`).toBe(false);
  expect(layout.minButtonHeight, `${label}: button height`).not.toBeNull();
  expect(layout.minButtonHeight!, `${label}: buttons at least 44px tall`).toBeGreaterThanOrEqual(44 - 0.5);
  expect(layout.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.messageLines, `${label}: bar text at most 2 lines`).toBeLessThanOrEqual(2);
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

test("strands 390 and 1440 keep grid above the bar without overflow", async ({ page, baseURL }) => {
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
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

    const layout = await page.evaluate(measureStrandsLayout);
    expectPlayableLayout(layout, viewport.label);
    await capture(page, `strands-ux-${viewport.label}`);
  }
});

test("strands 360 without banner keeps a touchable cell and a stable action bar", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("kpop-quiz-consent", "rejected");
  });
  await serveFixedStrands(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(joinBaseUrl(baseURL!, "/pt-br/palavras-conectadas/"));
  await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

  const layout = await page.evaluate(measureStrandsLayout);
  expectShortViewportLayout(layout, "360×740");
  await capture(page, "strands-ux-360");
});
