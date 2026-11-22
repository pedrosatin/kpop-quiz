import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/consent-build";
import { serveFixedStrands } from "./helpers/fixed-daily";
import { measureStrandsLayout, type StrandsLayoutMetrics } from "./helpers/strands-layout";
import { LOCAL_BUILD_TAG } from "./target";

test.describe(`strands layout with consent banner ${LOCAL_BUILD_TAG}`, () => {
  const evidenceDir = process.env.STRANDS_EVIDENCE_DIR;

  async function open(page: Page, consentURL: string) {
    await serveFixedStrands(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${consentURL}/pt-br/palavras-conectadas/`);
    await expect(page.getByTestId("game-board")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".consent-banner")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }

  function expectShortViewportBar(layout: StrandsLayoutMetrics, label: string) {
    expect(layout.firstRowTop, `${label}: first grid row`).not.toBeNull();
    expect(layout.actionsTop, `${label}: actions bar`).not.toBeNull();
    // UX contract item 1: at 360×740 with the banner, only the top of the board
    // must stay above the bar; the page may scroll for the rest of the grid.
    expect(layout.firstRowTop!, `${label}: top of the board above the bar`).toBeLessThan(
      (layout.actionsTop ?? layout.innerHeight) + 0.5,
    );
    expect(layout.cellSize, `${label}: cell size`).not.toBeNull();
    expect(layout.cellSize!, `${label}: cell at least Word Search phone floor (1.625rem)`).toBeGreaterThanOrEqual(
      layout.cellMinPx - 0.5,
    );
    expect(layout.maxButtonRight, `${label}: action buttons`).not.toBeNull();
    expect(layout.maxButtonRight!, `${label}: buttons stay inside the page`).toBeLessThanOrEqual(
      layout.innerWidth + 0.5,
    );
    expect(layout.buttonsOverlap, `${label}: action buttons do not overlap`).toBe(false);
    expect(layout.anyButtonTextClipped, `${label}: action button labels fully visible`).toBe(false);
    expect(layout.minButtonHeight, `${label}: button height`).not.toBeNull();
    expect(layout.minButtonHeight!, `${label}: buttons at least 44px tall`).toBeGreaterThanOrEqual(44 - 0.5);
    expect(layout.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(layout.innerWidth + 0.5);
    expect(layout.messageLines, `${label}: bar text at most 2 lines`).toBeLessThanOrEqual(2);
    if (layout.kickerLeft !== null) {
      expect(layout.kickerLeft, `${label}: kicker not clipped on the left`).toBeGreaterThanOrEqual(-0.5);
    }
  }

  test("360×740 with open banner keeps the board top above the bar with a touchable cell", async ({
    page,
    consentURL,
  }) => {
    await open(page, consentURL);

    const layout = await page.evaluate(measureStrandsLayout);
    expectShortViewportBar(layout, "360×740 + banner");

    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "metrics-360-banner.json"), JSON.stringify(layout, null, 2));
      await page.screenshot({
        path: join(evidenceDir, "strands-ux-360-banner.png"),
        fullPage: false,
        animations: "disabled",
      });
      await page.locator(".word-search-cell").nth(0).click();
      await page.locator(".word-search-cell").nth(1).click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const trail = await page.evaluate(measureStrandsLayout);
      writeFileSync(join(evidenceDir, "metrics-360-banner-trail.json"), JSON.stringify(trail, null, 2));
      await page.screenshot({
        path: join(evidenceDir, "strands-ux-360-banner-trail.png"),
        fullPage: false,
        animations: "disabled",
      });
    }
  });
});
