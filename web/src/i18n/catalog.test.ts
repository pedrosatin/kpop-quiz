import { describe, expect, it } from "vitest";
import { getMessages, type SeoRouteKey } from "./catalog";

const ROUTE_KEYS: SeoRouteKey[] = [
  "quiz",
  "grid",
  "connections",
  "nameGuess",
  "wordSearch",
];

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

const HOW_TO_PLAY_KEYS = [
  "quizHowToPlay",
  "gridHowToPlay",
  "connectionsHowToPlay",
  "nameGuessHowToPlay",
  "wordSearchHowToPlay",
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
