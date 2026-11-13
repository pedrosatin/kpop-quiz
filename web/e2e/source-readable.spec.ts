import type { Locator, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { joinBaseUrl } from "../src/lib/join-base-url";
import type { QuizQuestion, QuizSession } from "../src/lib/quiz-types";
import { expect, test } from "./fixtures/consent";
import { routeCrosswordDaily } from "./helpers/crossword-daily";
import { ConnectionsPage } from "./pages/connections.page";
import { GridPage } from "./pages/grid.page";
import { MapPage } from "./pages/map.page";
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

const viewports = [...phones, { width: 1280, height: 800 }] as const;

const LINK_NAME = /^Abrir esta revisão (na Wikipédia em [a-zà-ú]+|no Wikidata)$/;
const REVISION_HREF = /^https:\/\/(en\.wikipedia\.org|www\.wikidata\.org)\/w\/index\.php\?.*oldid=\d+/;
const CITATION = /(Wikipédia em [a-zà-ú]+|Wikidata), revisão \d+, (no resumo do artigo|na caixa de informações do artigo|na declaração "[^"]+"|no trecho citado)\./;
const LOCATOR = /^(wikipedia:[a-z-]+:pageid=\d+:revid=\d+#(extract|wikitext)\[\d+:\d+\]|claims[/.]P\d+.*)$/;

const DATA_DIR = new URL("../public/data/", import.meta.url);

/** Height a question's source panel takes, roughly: its places, then its text. */
function panelWeight(question: QuizQuestion): number {
  const places = new Set(question.evidence.map((e) => `${e.source_url}\u0000${e.revision_id}\u0000${e.locator}`)).size;
  const answer = question.options.find((option) => option.id === question.answer_option_id)?.label ?? "";
  return places * 200 + question.explanation.length + answer.length;
}

let largestSources: Map<string, QuizQuestion> | null = null;

/** Per play mode, the published pt-BR daily question with the largest source panel. */
function largestSource(playMode: string): QuizQuestion | undefined {
  if (!largestSources) {
    largestSources = new Map();
    for (const dir of ["", "next/"]) {
      let names: string[] = [];
      try {
        names = readdirSync(new URL(dir, DATA_DIR));
      } catch {
        continue;
      }
      for (const name of names.filter((n) => /^session\.daily\.pt-BR\.[a-z]+\.[0-9a-f]{64}\.json$/.test(n))) {
        const session = JSON.parse(readFileSync(new URL(`${dir}${name}`, DATA_DIR), "utf8")) as QuizSession;
        for (const question of session.questions) {
          const best = largestSources.get(question.play_mode);
          if (!best || panelWeight(question) > panelWeight(best)) largestSources.set(question.play_mode, question);
        }
      }
    }
  }
  return largestSources.get(playMode);
}

/**
 * Serves every pt-BR daily session with the largest published source as its
 * first question. The manifest names each session by its SHA-256, so the
 * rewritten session gets a new name and hash there.
 */
async function routeLargestSource(page: Page): Promise<void> {
  const rewritten = new Map<string, string>();
  await page.route(/\/data\/(?:next\/)?manifest-v2\.json$/, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const manifest = await response.json() as { sessions: Record<string, { path: string; session_id: string; sha256: string }> };
    const dir = route.request().url().replace(/manifest-v2\.json$/, "");
    for (const [key, entry] of Object.entries(manifest.sessions)) {
      if (!key.startsWith("daily.pt-BR.")) continue;
      const original = await page.request.get(`${dir}${entry.path}`);
      if (!original.ok()) continue;
      const session = await original.json() as QuizSession;
      const largest = largestSource(session.config.play_mode);
      if (!largest) continue;
      const rest = session.questions.filter((q) => q.id !== largest.id && q.semantic_id !== largest.semantic_id);
      const body = JSON.stringify({ ...session, questions: [largest, ...rest].slice(0, session.questions.length) });
      const sha256 = createHash("sha256").update(body).digest("hex");
      entry.path = `session.${key}.${sha256}.json`;
      entry.sha256 = sha256;
      rewritten.set(`${dir}${entry.path}`, body);
    }
    return route.fulfill({ response, json: manifest });
  });
  await page.route(/\/data\/(?:next\/)?session\.daily\.pt-BR\.[^/]+\.json$/, (route) => {
    const body = rewritten.get(route.request().url());
    return body ? route.fulfill({ status: 200, contentType: "application/json", body }) : route.continue();
  });
}

async function openQuiz(page: Page, baseURL: string): Promise<Locator> {
  await routeLargestSource(page);
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

/** Opens the result's source panel; giving up may have opened it already. */
async function openResultSource(page: Page): Promise<void> {
  const toggle = page.getByTestId("game-result").getByRole("button", { name: /^(Ver|Ocultar) fonte$/ });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function openGrid(page: Page, baseURL: string): Promise<Locator> {
  await new GridPage(page, baseURL).open();
  const board = page.getByTestId("game-board");
  await expect(board.or(page.getByTestId("game-missing"))).toBeVisible();
  test.skip(await page.getByTestId("game-missing").isVisible(), "grid.daily.json absent in this build");
  await page.getByRole("button", { name: "Desistir" }).click();
  await page.getByRole("button", { name: "Sim, desistir" }).click();
  await openResultSource(page);
  const panel = page.locator(".grid-source");
  // Each cell folds its sources; open them all.
  for (const summary of await panel.locator("details.grid-sources > summary").all()) await summary.click();
  return panel;
}

async function openConnections(page: Page, baseURL: string): Promise<Locator> {
  const game = new ConnectionsPage(page, baseURL);
  await game.open();
  await game.loseWithWrongGuesses();
  await page.getByTestId("game-result").getByRole("button", { name: "Ver fonte" }).click();
  return page.locator(".connections-source");
}

async function openMap(page: Page, baseURL: string): Promise<Locator> {
  await new MapPage(page, baseURL).open();
  await page.getByRole("button", { name: "Desistir" }).click();
  await page.getByRole("button", { name: "Sim, desistir" }).click();
  await openResultSource(page);
  return page.locator(".map-pilot-source");
}

async function openNameGuess(page: Page, baseURL: string): Promise<Locator> {
  const game = new NameGuessPage(page, baseURL);
  await game.open();
  await game.loseWithWrongGuesses();
  await page.getByTestId("game-result").getByRole("button", { name: "Ver fonte" }).click();
  return page.locator(".name-guess-hints");
}

/** Games whose panel reads each cited revision through SourceCitation. */
const games = [
  { name: "quiz", open: openQuiz },
  { name: "crossword", open: openCrossword },
  { name: "word search", open: openWordSearch },
  { name: "timeline", open: openTimeline },
  { name: "name guess", open: openNameGuess },
] as const;

/** Games that keep their own line and take only the link, SourceLink. */
const linkOnlyGames = [
  { name: "grid", open: openGrid },
  { name: "connections", open: openConnections },
  { name: "map", open: openMap },
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

async function expectReadableLinks(panel: Locator, { locator = true } = {}): Promise<void> {
  const links = panel.locator("a.source-citation-link");
  const count = await links.count();
  expect(count, "at least one revision link").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    await expect(link).toHaveText(LINK_NAME);
    await expect(link).toHaveAttribute("href", REVISION_HREF);
    if (locator) await expect(link).toHaveAttribute("title", LOCATOR);
    const href = (await link.getAttribute("href"))!;
    const name = (await link.textContent())!;
    expect(name.includes("Wikidata"), `${name} leads to ${href}`).toBe(href.includes("wikidata.org"));
  }
}

for (const viewport of viewports) {
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

    for (const game of linkOnlyGames) {
      test(`${game.name}: the open source reads whole, with links named after their destination`, async ({ page, baseURL }) => {
        const panel = await game.open(page, baseURL!);
        await expect(panel).toBeVisible();
        const text = await panel.innerText();
        // The site reads in the page's language: "Wikipédia em inglês", never "Wikipedia".
        expect(text, "no English site name in the Portuguese page").not.toMatch(/\bWikipedia\b/);
        expect(text, "no raw locator on screen").not.toMatch(/pageid=|revid=|#extract\[|#wikitext\[|claims\//);
        await expectNoInnerScroll(panel);
        await expectReadableLinks(panel, { locator: false });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  });
}

/**
 * The quiz keeps Next on screen when the largest published source opens:
 * opening the panel brings the bar into view, and Next sits whole inside
 * the window, where the player taps it without scrolling.
 */
for (const viewport of phones) {
  test(`${viewport.width}x${viewport.height} quiz: Next stays on screen with the largest source open`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const panel = await openQuiz(page, baseURL!);
    await expect(panel).toBeVisible();
    const next = page.getByTestId("game-board").getByRole("button", { name: "Próxima pergunta" });
    await expect(next).toBeVisible();
    const box = await next.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, innerHeight: window.innerHeight };
    });
    expect(box.top, "Next starts inside the window").toBeGreaterThanOrEqual(0);
    expect(box.bottom, `Next ends at ${box.bottom}px in a ${box.innerHeight}px window`).toBeLessThanOrEqual(box.innerHeight);
  });
}
