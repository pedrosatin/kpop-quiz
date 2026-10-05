import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMessages } from "../i18n/catalog";
import {
  SEO_DEFAULT_PATH,
  SEO_OG_IMAGE_DIR,
  SEO_OG_IMAGE_HEIGHT,
  SEO_OG_IMAGE_WIDTH,
  SEO_PROD_ORIGIN,
  SEO_ROUTES,
  seoAbsoluteUrl,
  seoOgImageAlt,
  seoOgImagePath,
  seoOgLocale,
  seoShareUrl,
} from "./seo-routes";

const PUBLIC_DIR = join(__dirname, "..", "..", "public");

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1"), path).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("SEO route table", () => {
  it("covers exactly the 14 indexable content routes", () => {
    expect(SEO_ROUTES).toHaveLength(14);
  });

  it("keeps /data/*, the root alias and query variants out of the sitemap", () => {
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

  it("points x-default at the default language route", () => {
    expect(SEO_DEFAULT_PATH).toBe("/pt-br/");
    expect(byPathHas("/pt-br/")).toBe(true);

    function byPathHas(path: string): boolean {
      return SEO_ROUTES.some((route) => route.path === path);
    }
  });
});

describe("share URLs", () => {
  it("point at the game in the player's language with share UTM tags", () => {
    expect(seoShareUrl("connections", "pt-BR")).toBe(
      "https://kpopquiz.online/pt-br/conexoes/?utm_source=share&utm_medium=social&utm_campaign=connections",
    );
    expect(seoShareUrl("connections", "en")).toBe(
      "https://kpopquiz.online/en/connections/?utm_source=share&utm_medium=social&utm_campaign=connections",
    );
    expect(seoShareUrl("quiz", "pt-BR")).toBe(
      "https://kpopquiz.online/pt-br/?utm_source=share&utm_medium=social&utm_campaign=quiz",
    );
  });

  it("use the canonical route of every game, with one campaign per game", () => {
    const campaigns = new Map<string, string>();
    for (const route of SEO_ROUTES) {
      const url = new URL(seoShareUrl(route.key, route.locale));
      expect(`${url.origin}${url.pathname}`).toBe(seoAbsoluteUrl(route.path));
      expect(url.searchParams.get("utm_source")).toBe("share");
      expect(url.searchParams.get("utm_medium")).toBe("social");
      const campaign = url.searchParams.get("utm_campaign")!;
      expect(campaign).toMatch(/^[a-z-]+$/);
      expect(campaigns.get(route.key) ?? campaign).toBe(campaign);
      campaigns.set(route.key, campaign);
    }
    expect(new Set(campaigns.values()).size).toBe(7);
  });
});

describe("OG images", () => {
  it("give each route its own 1200x630 PNG in public/og", () => {
    const paths = SEO_ROUTES.map((route) => seoOgImagePath(route.key, route.locale));
    expect(new Set(paths).size).toBe(SEO_ROUTES.length);
    for (const path of paths) {
      expect(path.startsWith(SEO_OG_IMAGE_DIR)).toBe(true);
      const size = pngSize(join(PUBLIC_DIR, ...path.split("/").filter(Boolean)));
      expect(size, path).toEqual({ width: SEO_OG_IMAGE_WIDTH, height: SEO_OG_IMAGE_HEIGHT });
    }
    expect([SEO_OG_IMAGE_WIDTH, SEO_OG_IMAGE_HEIGHT]).toEqual([1200, 630]);
  });

  it("ships no stale card", () => {
    const expected = SEO_ROUTES.map((route) => seoOgImagePath(route.key, route.locale).split("/").pop()).sort();
    expect(readdirSync(join(PUBLIC_DIR, "og")).sort()).toEqual(expected);
  });

  it("describe the card in the page language", () => {
    expect(seoOgImageAlt("connections", "pt-BR", getMessages("pt-BR"))).toBe(
      "Conexões, jogo diário do K-pop Quiz. kpopquiz.online",
    );
    expect(seoOgImageAlt("timeline", "en", getMessages("en"))).toBe(
      "Timeline, a daily K-pop Quiz game. kpopquiz.online",
    );
    expect(seoOgImageAlt("quiz", "en", getMessages("en"))).toBe(
      "K-pop Quiz. Daily K-pop games with sources. kpopquiz.online",
    );
  });
});
