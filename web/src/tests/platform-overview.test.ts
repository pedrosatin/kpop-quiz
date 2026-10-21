// @vitest-environment node
import { readFileSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import PlatformOverview from "../components/PlatformOverview.astro";
import { SEO_ROUTES } from "../lib/seo-routes";

describe("homepage game discovery", () => {
  it.each(["pt-BR", "en"] as const)("renders nine crawlable game links in %s", async (locale) => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(PlatformOverview, { props: { locale } });
    const doc = new JSDOM(html).window.document;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const links = [...doc.querySelectorAll("h3 a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SEO_ROUTES.filter((route) => route.locale === locale).map((route) => `${base}${route.path}`),
    );
    expect(links.every((link) => Boolean(link.textContent?.trim()))).toBe(true);
    expect(doc.body.textContent).toContain("BLACKPINK");
    expect(doc.body.textContent).toContain("DEADLINE");
    expect(doc.body.textContent).not.toContain("Mapa de origens");
  });

  it.each(["pt-br", "en"])("keeps %s discovery below the quiz", (locale) => {
    const page = readFileSync(new URL(`../pages/${locale}/index.astro`, import.meta.url), "utf-8");
    expect(page.indexOf("<PlatformOverview ")).toBeGreaterThan(page.indexOf("client:load"));
  });
});
