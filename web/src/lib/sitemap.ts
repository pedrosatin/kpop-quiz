import type { SeoRoute } from "./seo-routes";
import { seoAbsoluteUrl } from "./seo-routes";

/**
 * Sitemap XML for the canonical production routes. Every URL carries
 * `xhtml:link` alternates for its own language and the paired one, matching
 * the `<head>` hreflang.
 */
export function buildSitemapXml(routes: readonly SeoRoute[]): string {
  const byPath = new Map(routes.map((route) => [route.path, route]));
  const urls = routes.map((route) => {
    const alternate = byPath.get(route.alternatePath);
    const links = [route, alternate]
      .filter((entry): entry is SeoRoute => entry !== undefined)
      .sort((a, b) => a.locale.localeCompare(b.locale))
      .map(
        (entry) =>
          `    <xhtml:link rel="alternate" hreflang="${entry.locale}" href="${seoAbsoluteUrl(entry.path)}"/>`,
      );
    return ["  <url>", `    <loc>${seoAbsoluteUrl(route.path)}</loc>`, ...links, "  </url>"].join("\n");
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join("\n")}\n</urlset>\n`
  );
}
