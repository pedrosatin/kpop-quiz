import type { Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { expect, test } from "./fixtures/consent-build";
import { skipUnlessPublished } from "./helpers/published";

/**
 * Playtest 2026-11-11, bug 5, on the screens it was seen on. A round left at
 * question 3 in one language is offered back in the other language's setup
 * by a link in the action bar, on screen without scrolling, over the round
 * rules. The link arrives after hydration: Start must keep its position on
 * every frame from the first paint, and the page's CLS stays at or below 0.1.
 * The consent build renders the real banner, open at 360x740.
 */

const SHOTS = process.env.QUIZ_DAILY_SHOTS_DIR;

const viewports = [
  { name: "360x740-banner", width: 360, height: 740, banner: true },
  { name: "390x844", width: 390, height: 844, banner: false },
] as const;

const rounds = [
  {
    id: "pt",
    path: "/pt-br/",
    submit: "Responder",
    next: /Próxima pergunta/,
    question3: "Pergunta 3 de 10",
    to: { id: "en", path: "/en/", hint: "Game in Portuguese at question 3 · Continue in Portuguese" },
  },
  {
    id: "en",
    path: "/en/",
    submit: "Submit answer",
    next: /Next question/,
    question3: "Question 3 of 10",
    to: { id: "pt", path: "/pt-br/", hint: "Partida em inglês na pergunta 3 · Continuar em inglês" },
  },
] as const;

type Frame = { top: number; hint: boolean; banner: boolean };
type Trace = { frames: Frame[]; cls: number };

/**
 * Start's top on every frame, with whether the link and the consent banner
 * were in the page, and the layout shift without recent input, from the
 * first paint.
 */
async function traceLayout(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __trace: Trace };
    w.__trace = { frames: [], cls: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) w.__trace.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    const sample = () => {
      const start = document.querySelector('[data-testid="game-start"]');
      if (start) {
        w.__trace.frames.push({
          top: Math.round(start.getBoundingClientRect().top),
          hint: Boolean(document.querySelector('[data-testid="quiz-other-locale-hint"]')),
          banner: Boolean(document.querySelector(".consent-banner")),
        });
      }
      if (performance.now() < 6_000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function leaveRoundAtQuestion3(page: Page, url: string, round: (typeof rounds)[number]) {
  await page.goto(url);
  await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("game-start").click();
  const board = page.getByTestId("game-board");
  for (let i = 0; i < 2; i += 1) {
    await board.locator("label.option").first().click();
    await board.getByRole("button", { name: round.submit }).click();
    const next = board.getByRole("button", { name: round.next });
    await expect(next).toBeVisible();
    await page.waitForTimeout(NEXT_GUARD_MS + 50);
    await next.click();
  }
  await expect(board.getByText(round.question3)).toBeVisible();
}

for (const viewport of viewports) {
  for (const round of rounds) {
    test(`the action bar offers the ${round.id} round back on the ${round.to.id} setup without scrolling (${viewport.name})`, async ({ page, consentURL }) => {
      test.setTimeout(90_000);
      await skipUnlessPublished(page, consentURL, "manifest-v2.json", "catalog-manifest-v1.json");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (!viewport.banner) {
        await page.addInitScript((key) => window.localStorage.setItem(key, "rejected"), CONSENT_STORAGE_KEY);
      }
      await leaveRoundAtQuestion3(page, `${consentURL}${round.path}?theme=history&mode=standard`, round);

      await traceLayout(page);
      await page.goto(`${consentURL}${round.to.path}?mode=standard&theme=history`);
      const banner = page.locator(".consent-banner");
      if (viewport.banner) await expect(banner).toBeVisible();
      else await expect(banner).toHaveCount(0);

      const hint = page.getByTestId("quiz-other-locale-hint");
      await expect(hint).toHaveText(round.to.hint, { timeout: 30_000 });
      await expect(page.getByTestId("game-start")).toBeEnabled({ timeout: 30_000 });
      await page.waitForTimeout(1_000);

      // On screen without scrolling, above the banner, and nothing covers it.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const fold = viewport.banner ? (await banner.boundingBox())!.y : viewport.height;
      const box = (await hint.boundingBox())!;
      const startBox = (await page.getByTestId("game-start").boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, "the link ends above the fold").toBeLessThanOrEqual(fold);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(startBox.y - (box.y + box.height), "8px between the link and Start").toBeGreaterThanOrEqual(8);
      const covered = await hint.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !(hit && (hit === element || element.contains(hit)));
      });
      expect(covered, "nothing covers the link").toBe(false);
      // The rules under it keep the bar's height: two lines of link at most.
      const rules = (await page.locator(".setup-hint .setup-rules").boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(Math.max(rules.height, 44) + 1);

      const trace = await page.evaluate(() => (window as unknown as { __trace: Trace }).__trace);
      // The link never moves Start: the frame before it arrives and every
      // frame after it share one position. Without the banner that is every
      // frame from the first paint. With it, the bar first rises above the
      // banner once its height is known, before the link arrives; that move
      // belongs to the banner and happens on any visit.
      const firstHint = trace.frames.findIndex((frame) => frame.hint);
      expect(firstHint, "a frame before the link arrives").toBeGreaterThan(0);
      const tops = [...new Set(trace.frames.slice(firstHint - 1).map((frame) => frame.top))];
      expect(tops, `Start moved with the link: ${tops.join(", ")}`).toHaveLength(1);
      if (!viewport.banner) {
        const all = [...new Set(trace.frames.map((frame) => frame.top))];
        expect(all, `Start moved: ${all.join(", ")}`).toHaveLength(1);
      }
      expect(trace.cls).toBeLessThanOrEqual(0.1);
      test.info().annotations.push({
        type: "layout",
        description: `link ${Math.round(box.y)}-${Math.round(box.y + box.height)}, Start ${Math.round(startBox.y)}-${Math.round(startBox.y + startBox.height)}, fold ${Math.round(fold)}, CLS ${trace.cls.toFixed(4)}`,
      });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/barra-${viewport.name}-${round.to.id}.png` });

      await hint.click();
      await expect(page.getByTestId("game-board").getByText(round.question3)).toBeVisible({ timeout: 30_000 });
    });
  }
}
