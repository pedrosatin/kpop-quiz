import { describe, expect, it } from "vitest";
import {
  SEO_DEFAULT_PATH,
  SEO_PROD_ORIGIN,
  SEO_ROUTES,
  seoAbsoluteUrl,
  seoOgLocale,
} from "./seo-routes";

describe("SEO route table", () => {
  it("covers exactly the 10 indexable content routes", () => {
    expect(SEO_ROUTES).toHaveLength(10);
  });

  it("keeps /data/*, the redirect stub and query variants out of the index", () => {
    for (const route of SEO_ROUTES) {
      expect(route.path).not.toContain("/data/");
      expect(route.path).not.toBe("/");
      expect(route.path).not.toContain("?");
      expect(route.alternatePath).not.toContain("/data/");
    }
  });

  it("pairs every route with its alternate-language URL", () => {
    const byPath = new Map(SEO_ROUTES.map((route) => [route.path, route]));
    for (const route of SEO_ROUTES) {
      const alternate = byPath.get(route.alternatePath);
      expect(alternate, `alternate of ${route.path}`).toBeDefined();
      expect(alternate?.key).toBe(route.key);
      expect(alternate?.locale).not.toBe(route.locale);
      expect(alternate?.alternatePath).toBe(route.path);
    }
  });

  it("builds absolute URLs on the canonical production host", () => {
    expect(SEO_PROD_ORIGIN).toBe("https://kpopquiz.online");
    expect(seoAbsoluteUrl("/pt-br/grid/")).toBe(
      "https://kpopquiz.online/pt-br/grid/",
    );
  });

  it("maps locales to OG locale tags", () => {
    expect(seoOgLocale("pt-BR")).toBe("pt_BR");
    expect(seoOgLocale("en")).toBe("en_US");
  });

  it("points x-default at the redirect target", () => {
    expect(SEO_DEFAULT_PATH).toBe("/pt-br/");
    expect(byPathHas("/pt-br/")).toBe(true);

    function byPathHas(path: string): boolean {
      return SEO_ROUTES.some((route) => route.path === path);
    }
  });
});
