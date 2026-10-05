// @vitest-environment node
// The Astro container renders .astro files only in the node environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import axe from "axe-core";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import GameAbout from "../components/GameAbout.astro";
import { getMessages } from "../i18n/catalog";
import type { GameAboutKey } from "../i18n/game-about";

const PAGES: Array<{ path: string; locale: "pt-BR" | "en"; game: GameAboutKey }> = [
  { path: "pages/pt-br/grid.astro", locale: "pt-BR", game: "grid" },
  { path: "pages/pt-br/conexoes.astro", locale: "pt-BR", game: "connections" },
  { path: "pages/pt-br/adivinhe.astro", locale: "pt-BR", game: "nameGuess" },
  { path: "pages/pt-br/caca-palavras.astro", locale: "pt-BR", game: "wordSearch" },
  { path: "pages/pt-br/mapa.astro", locale: "pt-BR", game: "mapPilot" },
  { path: "pages/pt-br/linha-do-tempo.astro", locale: "pt-BR", game: "timeline" },
  { path: "pages/en/grid.astro", locale: "en", game: "grid" },
  { path: "pages/en/connections.astro", locale: "en", game: "connections" },
  { path: "pages/en/guess.astro", locale: "en", game: "nameGuess" },
  { path: "pages/en/word-search.astro", locale: "en", game: "wordSearch" },
  { path: "pages/en/map.astro", locale: "en", game: "mapPilot" },
  { path: "pages/en/timeline.astro", locale: "en", game: "timeline" },
];

const SRC = join(import.meta.dirname, "..");

// The bundled JSDOM typings omit the options argument; runScripts lets the
// test evaluate axe inside the rendered window.
const JSDOMWithOptions = JSDOM as unknown as new (html: string, options: { runScripts: "outside-only" }) => JSDOM;

async function render(locale: "pt-BR" | "en", game: GameAboutKey) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(GameAbout, { props: { locale, game } });
  const lang = locale === "pt-BR" ? "pt-BR" : "en";
  return new JSDOMWithOptions(
    `<!doctype html><html lang="${lang}"><head><title>t</title></head><body><main><h1>K-pop</h1>${html}</main></body></html>`,
    { runScripts: "outside-only" },
  );
}

describe("GameAbout", () => {
  it.each(PAGES)("$path renders GameAbout after the game island", ({ path, locale, game }) => {
    const page = readFileSync(join(SRC, path), "utf-8");
    const tag = `<GameAbout locale="${locale}" game="${game}" />`;
    expect(page).toContain(tag);
    expect(page.indexOf(tag)).toBeGreaterThan(page.indexOf("client:load"));
  });

  it.each(PAGES)("$path renders the three H2 sections and the FAQ as H3", async ({ locale, game }) => {
    const dom = await render(locale, game);
    const doc = dom.window.document;
    const { about } = getMessages(locale);
    const h2s = [...doc.querySelectorAll(".game-about h2")].map((node) => node.textContent?.trim());
    expect(h2s).toEqual([about.howToPlayHeading, about.dataSourcesHeading, about.faqHeading]);
    const h3s = [...doc.querySelectorAll(".game-about h3")].map((node) => node.textContent?.trim());
    expect(h3s).toEqual(about.games[game].faq.map((item) => item.question));
    for (const section of doc.querySelectorAll(".game-about section")) {
      const labelledBy = section.getAttribute("aria-labelledby");
      expect(labelledBy && doc.getElementById(labelledBy)?.tagName).toBe("H2");
    }
  });

  it.each(["pt-BR", "en"] as const)("passes axe in %s", async (locale) => {
    const dom = await render(locale, "connections");
    dom.window.eval(axe.source);
    const runner = (dom.window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(dom.window.document, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }, 30_000);
});
