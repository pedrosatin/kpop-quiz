import { describe, expect, it } from "vitest";
import { SEO_ROUTES } from "./seo-routes";
import { buildSitemapXml } from "./sitemap";

function urlBlocks(xml: string): string[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1] ?? "");
}

describe("sitemap", () => {
  const xml = buildSitemapXml(SEO_ROUTES);

  it("declares the sitemap and xhtml namespaces", () => {
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("lists the 14 canonical URLs without lastmod", () => {
    const blocks = urlBlocks(xml);
    expect(blocks).toHaveLength(14);
    for (const block of blocks) {
      expect(block).toMatch(/<loc>https:\/\/kpopquiz\.online\/[^<]+<\/loc>/);
      expect(block).not.toContain("<lastmod>");
    }
  });

  it("links each URL to itself and its paired language", () => {
    const block = urlBlocks(xml).find((entry) =>
      entry.includes("<loc>https://kpopquiz.online/pt-br/caca-palavras/</loc>"),
    );
    expect(block).toBeDefined();
    expect(block).toContain(
      '<xhtml:link rel="alternate" hreflang="pt-BR" href="https://kpopquiz.online/pt-br/caca-palavras/"/>',
    );
    expect(block).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://kpopquiz.online/en/word-search/"/>',
    );
    for (const entry of urlBlocks(xml)) {
      expect(entry.match(/<xhtml:link /g)).toHaveLength(2);
    }
  });
});
