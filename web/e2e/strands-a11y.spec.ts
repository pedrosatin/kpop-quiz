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

/** Layout metrics that catch the broken Strands action bar and covered grid. */
function measureStrandsLayout() {
  const actionsEl = document.querySelector(".word-search-actions, .game-actions") as HTMLElement | null;
  const messageEl = document.querySelector(
    ".word-search-actions .word-search-message:not(.visually-hidden), .game-actions .game-actions-message:not(.visually-hidden)",
  ) as HTMLElement | null;
  const rows = [...document.querySelectorAll(".word-search-row")];
  const lastRow = rows[rows.length - 1]?.getBoundingClientRect();
  const actions = actionsEl?.getBoundingClientRect();
  const consent = document.querySelector(".consent-banner")?.getBoundingClientRect();
  const coverTop = Math.min(actions?.top ?? Infinity, consent?.top ?? Infinity, window.innerHeight);
  const buttons = [...document.querySelectorAll(".word-search-actions > .btn, .game-actions > .btn")].map((btn) =>
    btn.getBoundingClientRect().right,
  );
  const cell = document.querySelector(".word-search-cell")?.getBoundingClientRect();
  const kicker = document.querySelector(".kicker")?.getBoundingClientRect();
  const theme = document.querySelector("[data-testid='strands-theme']")?.getBoundingClientRect();
  let messageLines = 0;
  if (messageEl) {
    const style = getComputedStyle(messageEl);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    messageLines = lineHeight > 0 ? Math.round(messageEl.getBoundingClientRect().height / lineHeight) : 0;
  }
  return {
    lastRowBottom: lastRow?.bottom ?? null,
    actionsTop: actions?.top ?? null,
    coverTop: Number.isFinite(coverTop) ? coverTop : null,
    maxButtonRight: buttons.length ? Math.max(...buttons) : null,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    messageLines,
    cellSize: cell ? Math.min(cell.width, cell.height) : null,
    kickerLeft: kicker?.left ?? null,
    themeTop: theme?.top ?? null,
    themeBottom: theme?.bottom ?? null,
  };
}

type LayoutMetrics = ReturnType<typeof measureStrandsLayout>;

function expectPlayableLayout(layout: LayoutMetrics, label: string) {
  expect(layout.lastRowBottom, `${label}: last grid row`).not.toBeNull();
  expect(layout.actionsTop, `${label}: actions bar`).not.toBeNull();
  expect(layout.lastRowBottom!, `${label}: last row above the bar`).toBeLessThanOrEqual(layout.actionsTop! + 0.5);
  expect(layout.maxButtonRight, `${label}: action buttons`).not.toBeNull();
  expect(layout.maxButtonRight!, `${label}: buttons stay inside the page`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
  expect(layout.messageLines, `${label}: bar text at most 2 lines`).toBeLessThanOrEqual(2);
  expect(layout.themeTop, `${label}: theme visible`).toBeGreaterThanOrEqual(-1);
  expect(layout.themeBottom!, `${label}: theme above the bar`).toBeLessThanOrEqual((layout.actionsTop ?? layout.innerHeight) + 0.5);
  if (layout.kickerLeft !== null) {
    expect(layout.kickerLeft, `${label}: kicker not clipped on the left`).toBeGreaterThanOrEqual(-0.5);
  }
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
