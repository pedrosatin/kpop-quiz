import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMessages, type SeoRouteKey } from "../i18n/catalog";
import { getGroupPageCopy } from "../i18n/group-pages";
import type { Locale } from "../lib/quiz-types";
import { GROUP_SEO_ROUTES, SEO_ROUTES, seoAbsoluteUrl } from "../lib/seo-routes";
import { isGroupPageKey } from "../lib/group-pages";

const LLMS_DIR = join(import.meta.dirname, "../../public/llms");

const FILE_SLUG: Partial<Record<SeoRouteKey, Record<Locale, string>>> = {
  quiz: { "pt-BR": "pt-br-quiz.md", en: "en-quiz.md" },
  grid: { "pt-BR": "pt-br-grid.md", en: "en-grid.md" },
  connections: { "pt-BR": "pt-br-conexoes.md", en: "en-connections.md" },
  nameGuess: { "pt-BR": "pt-br-adivinhe.md", en: "en-guess.md" },
  wordSearch: { "pt-BR": "pt-br-caca-palavras.md", en: "en-word-search.md" },
  mapPilot: { "pt-BR": "pt-br-mapa.md", en: "en-map.md" },
  timeline: { "pt-BR": "pt-br-linha-do-tempo.md", en: "en-timeline.md" },
  code: { "pt-BR": "pt-br-codigo.md", en: "en-code.md" },
  crossword: { "pt-BR": "pt-br-cruzadinha.md", en: "en-crossword.md" },
  strands: { "pt-BR": "pt-br-palavras-conectadas.md", en: "en-strands.md" },
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
      return { h1: messages.mapTitle, intro: messages.mapIntro };
    case "timeline":
      return { h1: messages.timelineTitle, intro: messages.timelineIntro };
    case "code":
      return { h1: messages.codeTitle, intro: messages.codeIntro };
    case "crossword":
      return { h1: messages.crosswordTitle, intro: messages.crosswordIntro };
    case "strands":
      return { h1: messages.strandsTitle, intro: messages.strandsIntro };
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

  for (const route of GROUP_SEO_ROUTES) {
    it(`summarizes group page ${route.path}`, () => {
      expect(isGroupPageKey(route.key)).toBe(true);
      const slug = route.path.split("/").filter(Boolean).join("-") + ".md";
      const file = join(LLMS_DIR, slug);
      expect(existsSync(file), file).toBe(true);
      const body = readFileSync(file, "utf-8").replace(/\s+/g, " ");
      const groupSlug = route.key.slice("group:".length);
      const copy = getGroupPageCopy(groupSlug, route.locale);
      expect(body, file).toContain(`# ${copy.title}`);
      expect(body, file).toContain(copy.intro.replace(/\s+/g, " "));
      expect(body, file).toContain(seoAbsoluteUrl(route.path));
      expect(body, file).toContain(seoAbsoluteUrl(route.alternatePath));
    });
  }
});
