import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/consent-build";
import { serveFixedStrands } from "./helpers/fixed-daily";
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

  test("360×740 with open banner keeps the last grid row above the bar", async ({ page, consentURL }) => {
    await open(page, consentURL);

    const layout = await page.evaluate(() => {
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
      let messageLines = 0;
      if (messageEl) {
        const style = getComputedStyle(messageEl);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
        messageLines = lineHeight > 0 ? Math.round(messageEl.getBoundingClientRect().height / lineHeight) : 0;
      }
      const cell = document.querySelector(".word-search-cell")?.getBoundingClientRect();
      const kicker = document.querySelector(".kicker")?.getBoundingClientRect();
      return {
        lastRowBottom: lastRow?.bottom ?? null,
        actionsTop: actions?.top ?? null,
        coverTop: Number.isFinite(coverTop) ? coverTop : null,
        maxButtonRight: buttons.length ? Math.max(...buttons) : null,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        messageLines,
        cellSize: cell ? Math.min(cell.width, cell.height) : null,
        kickerLeft: kicker?.left ?? null,
      };
    });

    expect(layout.lastRowBottom, "last grid row").not.toBeNull();
    expect(layout.actionsTop, "actions bar").not.toBeNull();
    expect(layout.lastRowBottom!, "last row above the bar").toBeLessThanOrEqual(layout.actionsTop! + 0.5);
    expect(layout.lastRowBottom!, "last row above the banner").toBeLessThanOrEqual((layout.coverTop ?? layout.actionsTop!) + 0.5);
    expect(layout.maxButtonRight!, "buttons stay inside the page").toBeLessThanOrEqual(layout.innerWidth + 0.5);
    expect(layout.scrollWidth, "no horizontal overflow").toBeLessThanOrEqual(layout.innerWidth + 0.5);
    expect(layout.messageLines, "bar text at most 2 lines").toBeLessThanOrEqual(2);
    if (layout.kickerLeft !== null) {
      expect(layout.kickerLeft, "kicker not clipped on the left").toBeGreaterThanOrEqual(-0.5);
    }

    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(evidenceDir, "strands-ux-360-banner.png"),
        fullPage: false,
        animations: "disabled",
      });
    }
  });
});
