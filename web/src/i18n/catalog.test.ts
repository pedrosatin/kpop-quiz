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
