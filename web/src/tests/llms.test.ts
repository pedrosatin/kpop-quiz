import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMessages, type SeoRouteKey } from "../i18n/catalog";
import type { Locale } from "../lib/quiz-types";
import { SEO_ROUTES, seoAbsoluteUrl } from "../lib/seo-routes";

const LLMS_DIR = join(import.meta.dirname, "../../public/llms");

const FILE_SLUG: Partial<Record<SeoRouteKey, Record<Locale, string>>> = {
  quiz: { "pt-BR": "pt-br-quiz.md", en: "en-quiz.md" },
  grid: { "pt-BR": "pt-br-grid.md", en: "en-grid.md" },
  connections: { "pt-BR": "pt-br-conexoes.md", en: "en-connections.md" },
  nameGuess: { "pt-BR": "pt-br-adivinhe.md", en: "en-guess.md" },
  wordSearch: { "pt-BR": "pt-br-caca-palavras.md", en: "en-word-search.md" },
};

function visibleCopy(locale: Locale, key: SeoRouteKey): { h1: string; intro: string } {
  const messages = getMessages(locale);
  switch (key) {
    case "quiz":
      return { h1: messages.title, intro: messages.intro };
    case "grid":
      return { h1: messages.gridTitle, intro: messages.gridIntro };
    case "connections":
      return { h1: messages.connectionsTitle, intro: messages.connectionsIntro };
    case "nameGuess":
      return { h1: messages.nameGuessTitle, intro: messages.nameGuessIntro };
    case "wordSearch":
      return { h1: messages.wordSearchTitle, intro: messages.wordSearchIntro };
    case "mapPilot":
      return {
        h1: locale === "pt-BR" ? "Quiz de mapa: BLACKPINK" : "Map quiz: BLACKPINK",
        intro: locale === "pt-BR"
          ? "Para cada data da turnê, escolha no mapa o país que a agenda oficial listou. Cada data tem link para a agenda e para o registro no MusicBrainz."
          : "For each tour date, pick on the map the country the official schedule listed. Every date links to the schedule and to its MusicBrainz record.",
      };
  }
}

// The llms/*.md summaries must track the visible H1/intro of their route.
describe("LLM route summaries", () => {
  it("publishes llms.txt", () => {
    expect(existsSync(join(import.meta.dirname, "../../public/llms.txt"))).toBe(true);
  });

  for (const route of SEO_ROUTES) {
    it(`summarizes ${route.path} with matching visible copy`, () => {
      const slug = FILE_SLUG[route.key]?.[route.locale];
      if (!slug) return;
      const file = join(LLMS_DIR, slug);
      expect(existsSync(file), file).toBe(true);
      const body = readFileSync(file, "utf-8").replace(/\s+/g, " ");
      const { h1, intro } = visibleCopy(route.locale, route.key);
      expect(body, file).toContain(`# ${h1}`);
      expect(body, file).toContain(intro.replace(/\s+/g, " "));
      expect(body, file).toContain(seoAbsoluteUrl(route.path));
      expect(body, file).toContain(seoAbsoluteUrl(route.alternatePath));
    });
  }
});
