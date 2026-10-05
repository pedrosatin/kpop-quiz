import { describe, expect, it } from "vitest";
import { getMessages, type Messages, type SeoRouteKey } from "./catalog";
import type { GameAboutKey } from "./game-about";

const ROUTE_KEYS: SeoRouteKey[] = [
  "quiz",
  "grid",
  "connections",
  "nameGuess",
  "wordSearch",
  "mapPilot",
  "timeline",
];

const GAME_ABOUT_KEYS: GameAboutKey[] = ["grid", "connections", "nameGuess", "wordSearch", "mapPilot", "timeline"];

const GAME_H1: Record<GameAboutKey, (messages: Messages) => string> = {
  grid: (messages) => messages.gridTitle,
  connections: (messages) => messages.connectionsTitle,
  nameGuess: (messages) => messages.nameGuessTitle,
  wordSearch: (messages) => messages.wordSearchTitle,
  mapPilot: (messages) => messages.mapTitle,
  timeline: (messages) => messages.timelineTitle,
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

const TITLE_SUFFIX = " | K-pop Quiz";

describe("SEO meta catalog", () => {
  for (const key of ROUTE_KEYS) {
    it(`defines meta for route "${key}" in both locales`, () => {
      for (const locale of ["pt-BR", "en"] as const) {
        const meta = getMessages(locale).meta[key];
        expect(meta.title.length, `${locale}.${key}.title`).toBeGreaterThan(0);
        expect(meta.description.length, `${locale}.${key}.description`).toBeGreaterThan(0);
      }
    });
  }

  for (const key of ROUTE_KEYS) {
    it(`keeps "${key}" titles/descriptions within length budgets`, () => {
      for (const locale of ["pt-BR", "en"] as const) {
        const meta = getMessages(locale).meta[key];
        expect(
          meta.title.length + TITLE_SUFFIX.length,
          `${locale}.${key}.title (${meta.title})`,
        ).toBeLessThanOrEqual(60);
        expect(
          meta.description.length,
          `${locale}.${key}.description (${meta.description})`,
        ).toBeLessThanOrEqual(155);
      }
    });
  }
});

describe("game page copy", () => {
  it.each(GAME_ABOUT_KEYS)("names K-pop in the %s h1 in both locales", (key) => {
    for (const locale of ["pt-BR", "en"] as const) {
      expect(GAME_H1[key](getMessages(locale))).toContain("K-pop");
    }
  });

  it("calls the name guess a K-pop Wordle in its title and description", () => {
    expect(getMessages("pt-BR").meta.nameGuess.title).toContain("Wordle de K-pop");
    expect(getMessages("pt-BR").meta.nameGuess.description).toContain("Wordle de K-pop");
    expect(getMessages("en").meta.nameGuess.title).toContain("K-pop Wordle");
    expect(getMessages("en").meta.nameGuess.description).toContain("K-pop Wordle");
  });

  it.each(GAME_ABOUT_KEYS)("gives %s 300 to 500 words of static text with 3 to 4 FAQ entries", (key) => {
    for (const locale of ["pt-BR", "en"] as const) {
      const { about } = getMessages(locale);
      const copy = about.games[key];
      const text = [
        about.howToPlayHeading,
        ...copy.howToPlay,
        about.dataSourcesHeading,
        ...copy.dataSources,
        about.faqHeading,
        ...copy.faq.flatMap((item) => [item.question, item.answer]),
      ].join(" ");
      const words = wordCount(text);
      expect(words, `${locale}.${key}`).toBeGreaterThanOrEqual(300);
      expect(words, `${locale}.${key}`).toBeLessThanOrEqual(500);
      expect(copy.faq.length).toBeGreaterThanOrEqual(3);
      expect(copy.faq.length).toBeLessThanOrEqual(4);
    }
  });

  it("keeps decorative dashes out of the static game text", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const text = JSON.stringify(getMessages(locale).about);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

const HOW_TO_PLAY_KEYS = [
  "quizHowToPlay",
  "gridHowToPlay",
  "connectionsHowToPlay",
  "nameGuessHowToPlay",
  "wordSearchHowToPlay",
  "mapHowToPlay",
] as const;

describe("how to play catalog", () => {
  for (const key of HOW_TO_PLAY_KEYS) {
    it(`defines 3 to 4 steps for "${key}" with the same count in both locales`, () => {
      const pt = getMessages("pt-BR")[key];
      const en = getMessages("en")[key];
      expect(pt.length).toBeGreaterThanOrEqual(3);
      expect(pt.length).toBeLessThanOrEqual(4);
      expect(en.length).toBe(pt.length);
      for (const step of [...pt, ...en]) {
        expect(step.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

describe("UI copy", () => {
  it("defines a skip link for every route and the privacy page", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const { skipLinks } = getMessages(locale);
      for (const key of [...ROUTE_KEYS, "privacy"] as const) {
        expect(skipLinks[key].length, `${locale}.skipLinks.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps internal jargon out of user-facing strings", () => {
    const collect = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap(collect);
      if (value && typeof value === "object") return Object.values(value).flatMap(collect);
      return [];
    };
    const text = [...collect(getMessages("pt-BR")), ...collect(getMessages("en"))].join("\n");
    expect(text).not.toMatch(/entidade|entity|auditad|audited|retorno de cores|grade temática/i);
  });
});
