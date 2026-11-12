import type { Locator, Page } from "@playwright/test";
import { joinBaseUrl } from "../src/lib/join-base-url";
import { expect, test } from "./fixtures/consent";
import { routeCrosswordDaily } from "./helpers/crossword-daily";
import { NameGuessPage } from "./pages/name-guess.page";
import { TimelinePage } from "./pages/timeline.page";
import { WordSearchPage } from "./pages/word-search.page";

/**
 * Playtest of 11/11/2026: "Ver fonte" scrolled inside a box (68px of the
 * quiz source, 288px of the crossword list), showed raw locators such as
 * `wikipedia:en:pageid=…:revid=…#extract[94:98]` and labelled a Wikipedia
 * link as Wikidata. On a phone each open panel must show every source at
 * full height, in words, with a link named after its destination.
 */

const phones = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
] as const;

const LINK_NAME = /^Abrir esta revisão (na Wikipédia em [a-zà-ú]+|no Wikidata)$/;
const REVISION_HREF = /^https:\/\/(en\.wikipedia\.org|www\.wikidata\.org)\/w\/index\.php\?.*oldid=\d+/;
const CITATION = /(Wikipédia em [a-zà-ú]+|Wikidata), revisão \d+, (no resumo do artigo|na caixa de informações do artigo|na declaração “[^”]+”|no trecho citado)\./;
const LOCATOR = /^(wikipedia:[a-z-]+:pageid=\d+:revid=\d+#(extract|wikitext)\[\d+:\d+\]|claims[/.]P\d+.*)$/;

async function openQuiz(page: Page, baseURL: string): Promise<Locator> {
  await page.goto(joinBaseUrl(baseURL, "/pt-br/"));
  await page.getByTestId("game-start").click();
  const board = page.getByTestId("game-board");
  await board.locator("label.option").first().click();
  await board.getByRole("button", { name: "Responder" }).click();
  await board.getByRole("button", { name: "Ver fonte" }).click();
  return board.locator(".quiz-source");
}

async function openCrossword(page: Page, baseURL: string): Promise<Locator> {
  await routeCrosswordDaily(page);
  await page.goto(joinBaseUrl(baseURL, "/pt-br/cruzadinha/"));
  const board = page.locator("#crossword");
  await board.getByRole("button", { name: "Revelar respostas", exact: true }).click();
  await page.getByRole("button", { name: "Sim, revelar" }).click();
  await board.getByRole("button", { name: "Ver fonte", exact: true }).click();
  return board.locator(".crossword-source");
}

async function openWordSearch(page: Page, baseURL: string): Promise<Locator> {
  const game = new WordSearchPage(page, baseURL);
  await game.open();
  await game.completeFromDailyCoords();
  await page.getByTestId("game-result").getByRole("button", { name: "Ver fonte" }).click();
  return page.locator(".word-search-source");
}

async function openTimeline(page: Page, baseURL: string): Promise<Locator> {
  const game = new TimelinePage(page, baseURL);
  await game.open();
  await game.submitDefaultOrder();
  await page.locator(".timeline-evidence-summary").click();
  return page.locator(".timeline-evidence-panel");
}

async function openNameGuess(page: Page, baseURL: string): Promise<Locator> {
  const game = new NameGuessPage(page, baseURL);
  await game.open();
  await game.loseWithWrongGuesses();
  await page.getByTestId("game-result").getByRole("button", { name: "Ver fonte" }).click();
  return page.locator(".name-guess-hints");
}

const games = [
  { name: "quiz", open: openQuiz },
  { name: "crossword", open: openCrossword },
  { name: "word search", open: openWordSearch },
  { name: "timeline", open: openTimeline },
  { name: "name guess", open: openNameGuess },
] as const;

/** Neither the panel nor a box around it inside main scrolls by itself. */
async function expectNoInnerScroll(panel: Locator): Promise<void> {
  const boxes = await panel.evaluate((el) => {
    const scrolling = [];
    for (let node: Element | null = el; node && node.tagName !== "MAIN"; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      const clips = overflowY !== "visible" && overflowY !== "clip";
      if (node === el || clips) {
        scrolling.push({ cls: node.getAttribute("class") ?? node.tagName, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
      }
    }
    return scrolling;
  });
  for (const box of boxes) {
    expect(box.scrollHeight, `${box.cls} scrolls inside (${box.scrollHeight} of ${box.clientHeight}px)`).toBeLessThanOrEqual(box.clientHeight + 1);
  }
}

async function expectReadableLinks(panel: Locator): Promise<void> {
  const links = panel.locator("a.source-citation-link");
  const count = await links.count();
  expect(count, "at least one revision link").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    await expect(link).toHaveText(LINK_NAME);
    await expect(link).toHaveAttribute("href", REVISION_HREF);
    await expect(link).toHaveAttribute("title", LOCATOR);
    const href = (await link.getAttribute("href"))!;
    const name = (await link.textContent())!;
    expect(name.includes("Wikidata"), `${name} leads to ${href}`).toBe(href.includes("wikidata.org"));
  }
}

for (const viewport of phones) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const game of games) {
      test(`${game.name}: the open source reads whole, in words, with a link named after its destination`, async ({ page, baseURL }) => {
        const panel = await game.open(page, baseURL!);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText(CITATION);
        const text = await panel.innerText();
        expect(text, "no raw locator on screen").not.toMatch(/pageid=|revid=|#extract\[|#wikitext\[|claims\//);
        await expectNoInnerScroll(panel);
        await expectReadableLinks(panel);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  });
}
