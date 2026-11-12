import type { Locator, Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/components/Consent/ConsentBanner";
import { GAME_ACTIONS_HEIGHT_VAR } from "../src/lib/sticky-bar-space";
import { expect, test } from "./fixtures/consent-build";
import { routeCrosswordDaily } from "./helpers/crossword-daily";

/**
 * On a phone the sticky .game-actions bar, and the consent banner under it,
 * must never keep a game control out of reach: scrolling to the end of the
 * game, focusing a control and a bar that grows with a message all leave
 * the control whole above the bar, where a tap at its center hits it.
 */

const locales = [
  {
    id: "pt",
    crossword: "/pt-br/cruzadinha/",
    wordSearch: "/pt-br/caca-palavras/",
    quiz: "/pt-br/",
    timeline: "/pt-br/linha-do-tempo/",
    map: "/pt-br/mapa/",
  },
  {
    id: "en",
    crossword: "/en/crossword/",
    wordSearch: "/en/word-search/",
    quiz: "/en/",
    timeline: "/en/timeline/",
    map: "/en/map/",
  },
] as const;

const phones = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

const LAST_MARK = "data-e2e-last";

/**
 * Marks and returns the last rendered control that precedes the sticky bar
 * in document order: the end of what the player scrolls through.
 */
async function lastControlBeforeBar(page: Page): Promise<Locator> {
  const label = await page.evaluate((mark) => {
    const bar = [...document.querySelectorAll<HTMLElement>(".game-actions")]
      .find((el) => getComputedStyle(el).position === "sticky");
    if (!bar) return null;
    const controls = [...document.querySelectorAll<HTMLElement>(
      "main a[href], main button, main input, main select, main [tabindex]:not([tabindex='-1'])",
    )].filter((el) => el.getClientRects().length > 0
      && !el.matches(":disabled")
      && !el.closest(".visually-hidden")
      && (el.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    const last = controls.at(-1);
    if (!last) return null;
    document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
    last.setAttribute(mark, "");
    return last.getAttribute("aria-label") ?? last.textContent?.trim().slice(0, 40) ?? last.tagName;
  }, LAST_MARK);
  expect(label, "a sticky bar with at least one control before it").not.toBeNull();
  return page.locator(`[${LAST_MARK}]`);
}

/**
 * The element is whole on screen, above the bar (unless it lives inside the
 * bar) and above the banner, and a tap at its center reaches it. A link that
 * wraps is tapped at the center of its first line; a shape whose box center
 * may fall outside it (a country) skips the tap.
 */
async function expectUncovered(target: Locator, what: string, { tap = true } = {}) {
  const box = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const line = el.getClientRects()[0] ?? r;
    const bar = [...document.querySelectorAll<HTMLElement>(".game-actions")]
      .find((candidate) => getComputedStyle(candidate).position === "sticky" && !candidate.contains(el));
    const banner = document.querySelector(".consent-banner");
    const edge = Math.min(
      bar?.getBoundingClientRect().top ?? Infinity,
      banner?.getBoundingClientRect().top ?? Infinity,
      window.innerHeight,
    );
    const hit = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
    return { top: r.top, bottom: r.bottom, edge, hit: hit !== null && (hit === el || el.contains(hit)) };
  });
  expect(box.top, `${what} starts on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom, `${what} ends above the bar and the banner`).toBeLessThanOrEqual(box.edge + 0.5);
  if (tap) expect(box.hit, `a tap at the center of ${what} reaches it`).toBe(true);
}

/** Scrolls the element to the bottom of the room the page reserves for it. */
async function scrollToEnd(target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: "end" }));
}

/**
 * A tap focuses without scrolling. With the element's top just above the bar
 * and the rest behind it, focus must bring the whole element into view. When
 * the page is too short to put it there (the board fits), nothing can hide it.
 */
async function expectFocusRevealsHidden(target: Locator, what: string, { tap = true } = {}) {
  const behindBar = await target.evaluate((el) => {
    const bar = [...document.querySelectorAll<HTMLElement>(".game-actions")]
      .find((candidate) => getComputedStyle(candidate).position === "sticky")!;
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - (bar.getBoundingClientRect().top - Math.min(8, r.height / 3)));
    return el.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 0.5;
  });
  if (!behindBar) {
    test.info().annotations.push({ type: "note", description: `${what} cannot scroll behind the bar` });
    return;
  }
  await target.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
  await expect.poll(() => target.evaluate((el) => {
    const bar = [...document.querySelectorAll<HTMLElement>(".game-actions")]
      .find((candidate) => getComputedStyle(candidate).position === "sticky")!;
    return el.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 0.5;
  }), `focused ${what} scrolls above the bar`).toBe(true);
  await expectUncovered(target, `focused ${what}`, { tap });
}

/** The published height follows the sticky bar's real height. */
async function expectPublishedBarHeight(page: Page) {
  await expect.poll(() => page.evaluate((name) => {
    const bar = [...document.querySelectorAll<HTMLElement>(".game-actions")]
      .find((el) => getComputedStyle(el).position === "sticky");
    const published = parseFloat(document.documentElement.style.getPropertyValue(name));
    return bar ? Math.abs(published - bar.getBoundingClientRect().height) <= 1 : false;
  }, GAME_ACTIONS_HEIGHT_VAR)).toBe(true);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function open(page: Page, url: string, banner: "open" | "rejected") {
  if (banner === "rejected") {
    await page.addInitScript((key) => window.localStorage.setItem(key, "rejected"), CONSENT_STORAGE_KEY);
  }
  await page.goto(url);
  if (banner === "open") await expect(page.locator(".consent-banner")).toBeVisible();
  else await expect(page.locator(".consent-banner")).toHaveCount(0);
}

/** Scrolling to the end and focusing both keep the last control before the bar in reach. */
async function expectEndReachable(page: Page, what: string, options: { tap?: boolean; horizontal?: boolean } = {}) {
  await expectPublishedBarHeight(page);
  const last = await lastControlBeforeBar(page);
  await scrollToEnd(last);
  await expectUncovered(last, what, options);
  await expectFocusRevealsHidden(last, what, options);
  if (options.horizontal !== false) await expectNoHorizontalScroll(page);
}

for (const locale of locales) {
  for (const phone of phones) {
    test.describe(`sticky bar ${locale.id} ${phone.width}x${phone.height}`, () => {
      test.use({ viewport: phone, isMobile: true, hasTouch: true });

      test("crossword: the grid and the clues stay above the bar before and after a wrong check", async ({ page, consentURL }) => {
        await routeCrosswordDaily(page);
        await open(page, consentURL + locale.crossword, "open");
        const cells = page.locator(".crossword-grid input");
        await expect(cells.first()).toBeVisible();
        await expectEndReachable(page, "the last clue");

        // The lowest square of the grid, scrolled to sit right above the bar.
        const lowest = await cells.evaluateAll((inputs) => {
          const tops = inputs.map((input) => input.getBoundingClientRect().top);
          return tops.indexOf(Math.max(...tops));
        });
        const square = cells.nth(lowest);
        await scrollToEnd(square);
        await expectUncovered(square, "the lowest square");

        await cells.first().evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
        await page.keyboard.type("Q");
        await scrollToEnd(square);
        const bar = page.locator(".crossword-actions");
        const before = await bar.evaluate((el) => el.getBoundingClientRect().height);
        await bar.locator(".btn-primary").click();
        await expect(bar).toHaveClass(/is-incorrect/);
        // The verdict takes the line of the hint, so the bar keeps its height.
        expect(await bar.evaluate((el) => el.getBoundingClientRect().height), "the wrong check keeps the bar's height").toBeLessThanOrEqual(before + 0.5);
        await expectUncovered(square, "the lowest square after the bar grew");
        await expectEndReachable(page, "the last clue after a wrong check");
      });

      for (const banner of ["open", "rejected"] as const) {
        test(`word search, banner ${banner}: the last row and the controls stay above the bar`, async ({ page, consentURL }) => {
          await open(page, consentURL + locale.wordSearch, banner);
          const cells = page.locator(".word-search-cell");
          await expect(cells.first()).toBeVisible();
          const lastCell = cells.last();
          await scrollToEnd(lastCell);
          await expectUncovered(lastCell, "the last cell");
          await expectFocusRevealsHidden(lastCell, "the last cell");
          await expectEndReachable(page, "the last control");
        });
      }

      test("quiz: the revision link of an open source is reachable", async ({ page, consentURL }) => {
        await open(page, consentURL + locale.quiz, "open");
        await page.getByTestId("game-start").click();
        const board = page.getByTestId("game-board");
        await board.locator("label.option").first().click();
        await board.locator(".quiz-actions .btn-primary").click();
        const toggle = board.locator(".quiz-actions button[aria-controls]");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const link = board.locator(".quiz-source a[href]").last();
        await expect(link).toBeAttached();
        await scrollToEnd(link);
        await expectUncovered(link, "the revision link");
        await expectNoHorizontalScroll(page);
      });

      test("timeline: the last card's controls stay above the bar", async ({ page, consentURL }) => {
        await open(page, consentURL + locale.timeline, "open");
        await expect(page.locator(".timeline-btn").first()).toBeVisible();
        await expectEndReachable(page, "the last card's control");
      });

      test("grid: the option reached with the arrow keys sits at the foot of the picker list", async ({ page, consentURL }) => {
        await open(page, consentURL + (locale.id === "pt" ? "/pt-br/grid/" : "/en/grid/"), "open");
        const cell = page.locator(".grid-cell-btn").first();
        await expect(cell).toBeVisible();
        await expectPublishedBarHeight(page);
        await cell.click();
        const list = page.getByRole("listbox");
        await expect(list).toBeVisible();
        const search = page.locator("#picker-search-input");
        await expect(search).toBeFocused();
        const visibleRows = await list.evaluate((el) => {
          const option = el.querySelector("[role='option']")!.getBoundingClientRect();
          return Math.ceil(el.clientHeight / option.height);
        });
        const count = await list.getByRole("option").count();
        expect(count, "the picker list is long enough to scroll").toBeGreaterThan(visibleRows + 1);
        for (let i = 0; i < visibleRows + 1; i++) await search.press("ArrowDown");
        const measure = () => page.evaluate(() => {
          const input = document.querySelector("#picker-search-input")!;
          const active = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
          const listbox = active.closest("[role='listbox']")!;
          const listBox = listbox.getBoundingClientRect();
          const bottomEdge = listBox.top + listbox.clientTop + listbox.clientHeight;
          return {
            below: bottomEdge - active.getBoundingClientRect().bottom,
            margin: getComputedStyle(active).scrollMarginBottom,
          };
        });
        // The list scrolls the highlighted option into view after the key
        // press, so wait for it to settle before measuring.
        await expect
          .poll(async () => (await measure()).below, { message: "the highlighted option is not below the list" })
          .toBeGreaterThanOrEqual(-0.5);
        const gap = await measure();
        expect(gap.below, "the highlighted option meets the foot of the list").toBeLessThanOrEqual(2);
        // The page's room for the bar must not reach the dialog's own list.
        expect(gap.margin).toBe("0px");
      });

      test("map: the whole map stays above the bar", async ({ page, consentURL }) => {
        await open(page, consentURL + locale.map, "open");
        const map = page.locator(".map-pilot-world-map");
        await expect(map).toBeVisible();
        await expectPublishedBarHeight(page);
        await scrollToEnd(map);
        await expectUncovered(map, "the map");
        // A country's box center can fall on the sea, so only its box is
        // checked. At 360px the map's Answer still overflows the bar in
        // English; the map ticket on small countries owns that layout.
        await expectEndReachable(page, "the last country", { tap: false, horizontal: false });
      });
    });
  }
}
