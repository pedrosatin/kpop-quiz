import type { Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { NEXT_GUARD_MS } from "../src/components/Quiz/AnswerFeedback";
import { expect, test } from "./fixtures/consent-build";
import { skipUnlessPublished } from "./helpers/published";
import { LOCAL_BUILD_TAG } from "./target";

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
  { name: "360x740-banner-dpr1.33", width: 360, height: 740, banner: true, dpr: 1.33 },
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

/**
 * One animation frame: Start's top, the action bar's height and Start's
 * offset inside it, whether the link is in the page, and the banner height
 * the page has applied to the bar (`--consent-banner-height`, empty until the
 * banner publishes it).
 */
type Frame = { top: number; barHeight: number; offset: number; hint: boolean; bannerHeight: string };
type Trace = { frames: Frame[]; cls: number };

/**
 * Every frame from the first paint, and the layout shift without recent
 * input. Sampling has no time limit, because on a busy machine the first
 * frame of the page can come after several seconds.
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
      const bar = start?.closest(".setup-actions");
      if (start && bar) {
        const startTop = start.getBoundingClientRect().top;
        const barRect = bar.getBoundingClientRect();
        w.__trace.frames.push({
          top: Math.round(startTop),
          barHeight: Math.round(barRect.height),
          offset: Math.round(startTop - barRect.top),
          hint: Boolean(document.querySelector('[data-testid="quiz-other-locale-hint"]')),
          bannerHeight: getComputedStyle(document.documentElement).getPropertyValue("--consent-banner-height").trim(),
        });
      }
      requestAnimationFrame(sample);
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
  test.describe(viewport.name, { tag: LOCAL_BUILD_TAG }, () => {
    if ("dpr" in viewport) test.use({ deviceScaleFactor: viewport.dpr });
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
        // Two things may move Start, and only one is allowed. The banner and
        // the quiz are separate islands that hydrate in either order; once the
        // banner publishes its height, the bar rises above it as a whole. The
        // link must never move Start: from the first paint the bar keeps its
        // height and Start its offset inside it, and Start's top changes only
        // on the frame where the banner height changes, by exactly that change
        // the other way. A link that arrives on the same frame and moves the
        // whole bar shows up as a difference from that amount.
        const frames = trace.frames;
        expect(frames.some((frame) => !frame.hint), "a frame before the link arrives").toBe(true);
        const shapes = [...new Set(frames.map((frame) => `${frame.barHeight}/${frame.offset}`))];
        expect(shapes, `the bar changed shape (height/offset of Start): ${shapes.join(", ")}`).toHaveLength(1);
        const steps = frames.slice(1).map((after, i) => ({ before: frames[i]!, after }));
        const moves = steps.filter(({ before, after }) => after.top !== before.top);
        const linkMoves = moves.filter(({ before, after }) => before.bannerHeight === after.bannerHeight);
        expect(linkMoves, `Start moved without a banner height change: ${JSON.stringify(linkMoves)}`).toEqual([]);
        // An unset variable is a banner of 0px. Fractional DPR can round
        // the sampled positions 1px apart from the published height change.
        const px = (height: string) => parseFloat(height) || 0;
        const offBanner = steps.filter(({ before, after }) => before.bannerHeight !== after.bannerHeight
          && Math.abs(after.top - before.top - (px(before.bannerHeight) - px(after.bannerHeight))) > 1);
        expect(offBanner, `Start moved by other than the banner height change: ${JSON.stringify(offBanner)}`).toEqual([]);
        if (!viewport.banner) expect(moves, "Start moved").toEqual([]);
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
  });
}
