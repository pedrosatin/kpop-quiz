import type { SeoRoute } from "./seo-routes";
import { seoAbsoluteUrl } from "./seo-routes";

/**
 * Sitemap XML for the canonical production routes. Every URL carries
 * `xhtml:link` alternates for its own language, the paired one and
 * `x-default` (the English version), matching the `<head>` hreflang.
 * Omit `lastmod` until reliable per-route significant modification dates
 * are available.
 */
export function buildSitemapXml(routes: readonly SeoRoute[]): string {
  const byPath = new Map(routes.map((route) => [route.path, route]));
  const urls = routes.map((route) => {
    const alternate = byPath.get(route.alternatePath);
    const pair = [route, alternate].filter(
      (entry): entry is SeoRoute => entry !== undefined,
    );
    const links = [...pair]
      .sort((a, b) => a.locale.localeCompare(b.locale))
      .map(
        (entry) =>
          `    <xhtml:link rel="alternate" hreflang="${entry.locale}" href="${seoAbsoluteUrl(entry.path)}"/>`,
      );
    const english = pair.find((entry) => entry.locale === "en");
    if (english) {
      links.push(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${seoAbsoluteUrl(english.path)}"/>`,
      );
    }
    const lines = ["  <url>", `    <loc>${seoAbsoluteUrl(route.path)}</loc>`];
    lines.push(...links, "  </url>");
    return lines.join("\n");
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join("\n")}\n</urlset>\n`
  );
}
