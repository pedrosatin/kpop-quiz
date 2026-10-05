import type { SeoRoute } from "./seo-routes";
import { seoAbsoluteUrl } from "./seo-routes";

function hreflang(route: SeoRoute): string {
  return route.locale === "pt-BR" ? "pt-BR" : "en";
}

/**
 * Sitemap XML for the canonical production routes. Every URL carries
 * `<lastmod>` (the build date: deploys follow the daily puzzle generation, so
 * each page's content is as fresh as the build) and `xhtml:link` alternates
 * for its own language and the paired one, matching the `<head>` hreflang.
 */
export function buildSitemapXml(routes: readonly SeoRoute[], lastmod: Date): string {
  const day = lastmod.toISOString().slice(0, 10);
  const byPath = new Map(routes.map((route) => [route.path, route]));
  const urls = routes.map((route) => {
    const alternate = byPath.get(route.alternatePath);
    const links = [route, alternate]
      .filter((entry): entry is SeoRoute => entry !== undefined)
      .sort((a, b) => hreflang(a).localeCompare(hreflang(b)))
      .map(
        (entry) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflang(entry)}" href="${seoAbsoluteUrl(entry.path)}"/>`,
      );
    return [
      "  <url>",
      `    <loc>${seoAbsoluteUrl(route.path)}</loc>`,
      `    <lastmod>${day}</lastmod>`,
      ...links,
      "  </url>",
    ].join("\n");
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join("\n")}\n</urlset>\n`
  );
}
